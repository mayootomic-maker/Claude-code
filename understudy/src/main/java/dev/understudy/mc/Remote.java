package dev.understudy.mc;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import dev.understudy.core.remote.Command;
import dev.understudy.core.remote.Query;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.Executors;
import java.util.function.Consumer;

/**
 * The control panel's other half: a small web server inside the game.
 *
 * There is no dependency here. Java has had an HTTP server in it since 2006 and
 * this needs three routes, so bringing in a framework to serve one page and two
 * endpoints would be more code in the jar than the whole mod.
 *
 * **Threading is the part that matters.** Minecraft's state may only be touched
 * on the client thread, and every request arrives on a socket thread. So
 * nothing here reads the game: requests drop a validated action into a queue
 * that the client tick drains, and the state the panel reads is a snapshot the
 * client tick rebuilds a few times a second and publishes as a finished string.
 * Neither side ever waits for the other, and the game is never touched from
 * anywhere it should not be.
 *
 * **What it will do.** Only what the panel is allowed to name, which is a dozen
 * verbs validated in core.remote.Command with no path from the network to "run
 * this text". Nothing here can type in chat, run a server command, or read a
 * file. Everything a panel can do, a person sitting at the game can already do
 * from the menu.
 *
 * **Who may.** It listens on the loopback address by default, so only this
 * machine can reach it at all, and every request needs a token generated fresh
 * each session. Opening it to the rest of the house is a separate, deliberate
 * command — because a control panel for your character reachable by anyone on
 * the café wifi is not a feature.
 */
public final class Remote {

    /** Not a registered port, easy to remember, and next to the game's own. */
    public static final int PORT = 25585;
    /** How often the snapshot is rebuilt. Five times a second is smoother than the eye. */
    public static final int REFRESH_TICKS = 4;
    /** Nothing the panel sends is longer than this. */
    private static final int LONGEST_BODY = 4096;

    private static HttpServer server;
    private static String token = "";
    private static boolean wideOpen;
    private static volatile String snapshot = "{}";
    private static final ConcurrentLinkedQueue<Command.Action> waiting = new ConcurrentLinkedQueue<>();

    private Remote() {}

    public static boolean running() {
        return server != null;
    }

    public static String token() {
        return token;
    }

    public static boolean openToTheNetwork() {
        return wideOpen;
    }

    /** The address to open, with the token already in it. */
    public static String address() {
        return "http://" + (wideOpen ? hostAddress() : "127.0.0.1") + ":" + PORT + "/?k=" + token;
    }

    /**
     * The address as it looks from another device on the same network.
     *
     * Shown in the panel itself rather than only in chat, because the phone
     * case is the one where somebody really does have to read an address off a
     * screen and type it — and a monitor is a much better thing to read it from
     * than a scrolling chat log.
     */
    public static String networkAddress() {
        return "http://" + hostAddress() + ":" + PORT + "/?k=" + token;
    }

    /**
     * Start listening.
     *
     * @param toTheNetwork whether other machines may reach it. Off by default and
     *                     asked for explicitly, because a panel that drives your
     *                     character should not be answerable to a café wifi.
     */
    public static synchronized boolean start(boolean toTheNetwork, Consumer<String> report) {
        stop(null);
        try {
            token = freshToken();
            wideOpen = toTheNetwork;
            InetSocketAddress where = toTheNetwork
                    ? new InetSocketAddress(PORT)
                    : new InetSocketAddress(InetAddress.getLoopbackAddress(), PORT);
            server = HttpServer.create(where, 0);
            server.createContext("/", Remote::route);
            // A couple of threads: the panel polls, it does not stream, and a
            // pool that can grow without limit is a pool something can exhaust.
            server.setExecutor(Executors.newFixedThreadPool(2, runnable -> {
                Thread thread = new Thread(runnable, "understudy-panel");
                thread.setDaemon(true);
                return thread;
            }));
            server.start();
            writeTheAddress(report);
            report.accept("panel at " + address());
            if (toTheNetwork) {
                report.accept("open to your network — anyone with the link can drive this character");
            }
            return true;
        } catch (IOException problem) {
            report.accept("could not start the panel: " + problem.getMessage());
            server = null;
            return false;
        }
    }

    public static synchronized void stop(Consumer<String> report) {
        if (server != null) {
            server.stop(0);
            server = null;
            if (report != null) report.accept("panel stopped");
        }
        waiting.clear();
    }

    /** Publish what the panel should see. Called from the client thread only. */
    public static void publish(String json) {
        snapshot = json;
    }

    /** Take the next thing the panel asked for, or null. Client thread only. */
    public static Command.Action next() {
        return waiting.poll();
    }

    private static void route(HttpExchange exchange) {
        try (exchange) {
            String path = exchange.getRequestURI().getPath();
            Map<String, String> query = Query.parse(exchange.getRequestURI().getRawQuery());

            // The page itself is the one thing served without a token, because
            // it has to load before it can send one — and it is a static page
            // with nothing in it. Everything it then asks for needs the token.
            if (path.equals("/") || path.equals("/index.html")) {
                send(exchange, 200, "text/html; charset=utf-8", Panel.html());
                return;
            }
            if (!allowed(query, exchange)) {
                send(exchange, 401, "application/json", "{\"error\":\"bad token\"}");
                return;
            }
            switch (path) {
                case "/state" -> send(exchange, 200, "application/json", snapshot);
                case "/do" -> {
                    Command.Action action = Command.parse(query);
                    if (action == null) {
                        send(exchange, 400, "application/json", "{\"error\":\"not a command\"}");
                        return;
                    }
                    // Bounded, so a panel left open in a broken loop cannot fill
                    // memory faster than the client thread drains it.
                    if (waiting.size() < 64) waiting.add(action);
                    send(exchange, 200, "application/json", "{\"ok\":true}");
                }
                default -> send(exchange, 404, "application/json", "{\"error\":\"no\"}");
            }
        } catch (Exception problem) {
            // A socket thread that throws takes the handler down and the panel
            // stops answering, with nothing on screen to say why.
            try {
                send(exchange, 500, "application/json", "{\"error\":\"failed\"}");
            } catch (IOException ignored) {
                // The other end has already gone. Nothing to say and nobody to say it to.
            }
        }
    }

    /**
     * The token, compared without leaking how much of it was right.
     *
     * A plain equals returns as soon as two characters differ, which over enough
     * attempts tells you the token one character at a time. It is a stretch on a
     * loopback socket and it costs one line to not have to think about.
     */
    private static boolean allowed(Map<String, String> query, HttpExchange exchange) {
        String offered = query.get("k");
        if (offered == null) offered = exchange.getRequestHeaders().getFirst("X-Understudy");
        if (offered == null || token.isEmpty()) return false;
        return java.security.MessageDigest.isEqual(
                offered.getBytes(StandardCharsets.UTF_8),
                token.getBytes(StandardCharsets.UTF_8));
    }

    private static void send(HttpExchange exchange, int code, String type, String body)
            throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", type);
        // Nothing here is meant to be embedded anywhere else, and saying so
        // stops a page in another tab quietly driving the character.
        exchange.getResponseHeaders().set("X-Frame-Options", "DENY");
        exchange.getResponseHeaders().set("Cache-Control", "no-store");
        exchange.sendResponseHeaders(code, bytes.length);
        try (OutputStream out = exchange.getResponseBody()) {
            out.write(bytes);
        }
        drain(exchange.getRequestBody());
    }

    private static void drain(InputStream body) {
        try (body) {
            body.readNBytes(LONGEST_BODY);
        } catch (IOException ignored) {
            // Nothing depends on the body; the panel sends everything in the query.
        }
    }

    /**
     * Nine random bytes: twelve characters.
     *
     * Shorter than it was, deliberately. The panel opens itself and the link is
     * written to a file, so nobody should ever type this — but "should" is
     * doing a lot of work in that sentence, and the one case where it has to be
     * typed is the worst one: reading it off a monitor onto a phone. Twenty-two
     * characters made that miserable. Seventy-two bits, fresh every session, on
     * a socket that is loopback-only unless asked otherwise, is not the weak
     * part of this.
     */
    private static String freshToken() {
        byte[] bytes = new byte[9];
        new SecureRandom().nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    /**
     * Open it in whatever browser this machine uses.
     *
     * The thing that made the panel awkward on the first run: Minecraft's chat
     * cannot be copied from, so a link printed there is a link you retype by
     * hand, twenty-two characters of token included. This removes the step
     * entirely.
     *
     * Done without touching Minecraft's API at all — java.awt.Desktop where it
     * works, and the platform's own opener where it does not, which is what
     * every launcher has always done. On a background thread because opening a
     * browser can take a second and the client tick is not the place to spend
     * it.
     */
    public static void openInBrowser(Consumer<String> report) {
        String link = address();
        Thread opener = new Thread(() -> {
            if (viaDesktop(link) || viaTheShell(link)) return;
            report.accept("could not open a browser — the link is in "
                    + "config/understudy/panel-url.txt");
        }, "understudy-open");
        opener.setDaemon(true);
        opener.start();
    }

    private static boolean viaDesktop(String link) {
        try {
            java.awt.Desktop desktop = java.awt.Desktop.isDesktopSupported()
                    ? java.awt.Desktop.getDesktop() : null;
            if (desktop == null || !desktop.isSupported(java.awt.Desktop.Action.BROWSE)) {
                return false;
            }
            desktop.browse(java.net.URI.create(link));
            return true;
        } catch (Throwable headless) {
            // A game with no AWT, or a Linux desktop without the bridge. Neither
            // is a problem worth a stack trace; there is another way below.
            return false;
        }
    }

    private static boolean viaTheShell(String link) {
        String os = System.getProperty("os.name", "").toLowerCase();
        String[] command;
        if (os.contains("win")) {
            command = new String[]{"rundll32", "url.dll,FileProtocolHandler", link};
        } else if (os.contains("mac")) {
            command = new String[]{"open", link};
        } else {
            command = new String[]{"xdg-open", link};
        }
        try {
            new ProcessBuilder(command).start();
            return true;
        } catch (IOException nothingToOpenWith) {
            return false;
        }
    }

    /**
     * Put the live address somewhere a shortcut can find it.
     *
     * The token changes every session, which is the point of it — and it also
     * means a bookmark goes stale every time. Writing the current link to a
     * known file lets the launcher script open the panel with nothing to type
     * and nothing to remember, which is the difference between a URL and
     * something that behaves like an application.
     */
    private static void writeTheAddress(Consumer<String> report) {
        try {
            java.nio.file.Path file = net.fabricmc.loader.api.FabricLoader.getInstance()
                    .getConfigDir().resolve("understudy").resolve("panel-url.txt");
            java.nio.file.Files.createDirectories(file.getParent());
            java.nio.file.Files.writeString(file, address() + System.lineSeparator());
        } catch (IOException problem) {
            // The panel still works; only the shortcut does not. Say so rather
            // than failing to start over a file nobody has asked for yet.
            report.accept("could not write the shortcut file: " + problem.getMessage());
        }
    }

    private static String hostAddress() {
        try {
            return InetAddress.getLocalHost().getHostAddress();
        } catch (Exception unknown) {
            return "your-ip";
        }
    }
}
