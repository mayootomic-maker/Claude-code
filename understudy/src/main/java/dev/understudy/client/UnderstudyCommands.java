package dev.understudy.client;

import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import dev.understudy.core.adapt.PlayerProfile;
import dev.understudy.core.build.Blueprint;
import dev.understudy.core.build.Schematic;
import dev.understudy.core.build.Sized;
import dev.understudy.core.help.Manual;
import dev.understudy.core.build.Catalog;
import dev.understudy.core.build.Designs;
import dev.understudy.core.build.Materials;
import dev.understudy.core.craft.Catalogue;
import dev.understudy.core.craft.Planner;
import dev.understudy.mc.Autopilot;
import dev.understudy.mc.Carried;
import dev.understudy.mc.Senses;
import dev.understudy.mc.EnchantTask;
import dev.understudy.mc.Fight;
import dev.understudy.mc.Remote;
import dev.understudy.mc.GatherTask;
import dev.understudy.mc.HuntTask;
import dev.understudy.mc.BuildTask;
import dev.understudy.mc.ChatFix;
import dev.understudy.mc.Hud;
import dev.understudy.mc.Imports;
import dev.understudy.mc.SelfTest;
import dev.understudy.mc.PasteTask;
import dev.understudy.mc.StashTask;
import dev.understudy.mc.SortTask;
import dev.understudy.mc.TravelTask;
import net.minecraft.client.Minecraft;
import net.minecraft.world.entity.monster.Monster;
import net.minecraft.world.entity.Entity;
import net.minecraft.client.player.LocalPlayer;
import dev.understudy.core.sort.Category;
import dev.understudy.core.mind.Agenda;
import dev.understudy.core.mind.Project;
import dev.understudy.core.remote.Command;

import java.util.List;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import net.fabricmc.fabric.api.client.command.v2.ClientCommandRegistrationCallback;
import net.fabricmc.fabric.api.client.command.v2.FabricClientCommandSource;
import net.minecraft.network.chat.Component;
import net.minecraft.core.BlockPos;

import static net.fabricmc.fabric.api.client.command.v2.ClientCommands.argument;
import static net.fabricmc.fabric.api.client.command.v2.ClientCommands.literal;

/**
 * The commands you type.
 *
 * Registered on the client dispatcher, so they complete in the client and the
 * server never receives them.
 */
public final class UnderstudyCommands {
    private UnderstudyCommands() {}

    public static void register() {
        ClientCommandRegistrationCallback.EVENT.register((dispatcher, access) -> {
            dispatcher.register(literal("travel")
                    .then(argument("x", IntegerArgumentType.integer())
                            .then(argument("y", IntegerArgumentType.integer())
                                    .then(argument("z", IntegerArgumentType.integer())
                                            .executes(context -> guarded(context.getSource(), "travel",
                                                    () -> travel(
                                                            context.getSource(),
                                                            IntegerArgumentType.getInteger(context, "x"),
                                                            IntegerArgumentType.getInteger(context, "y"),
                                                            IntegerArgumentType.getInteger(context, "z")))))))
                    .then(literal("stop").executes(context -> stop(context.getSource()))));

            dispatcher.register(literal("build")
                    // No arguments opens the menu. Typing the name still works,
                    // because a menu is slower than knowing what you want.
                    .executes(context -> openPicker(context.getSource()))
                    .then(literal("cancel").executes(context -> cancelSite(context.getSource())))
                    .then(literal("imports").executes(context -> imports(context.getSource())))
                    .then(argument("what", StringArgumentType.word())
                            .executes(context -> build(context.getSource(),
                                    StringArgumentType.getString(context, "what"), 7, false))
                            .then(argument("size", IntegerArgumentType.integer(3, 32))
                                    .executes(context -> build(context.getSource(),
                                            StringArgumentType.getString(context, "what"),
                                            IntegerArgumentType.getInteger(context, "size"), false))))
                    .then(literal("stop").executes(context -> stop(context.getSource()))));

            dispatcher.register(literal("plan")
                    .then(argument("what", StringArgumentType.word())
                            .executes(context -> build(context.getSource(),
                                    StringArgumentType.getString(context, "what"), 7, true))
                            .then(argument("size", IntegerArgumentType.integer(3, 32))
                                    .executes(context -> build(context.getSource(),
                                            StringArgumentType.getString(context, "what"),
                                            IntegerArgumentType.getInteger(context, "size"), true)))));

            // /get is the planner and the gatherer with a one-line front door:
            // name a thing and how many, and it works out the whole chain and
            // goes and does it.
            dispatcher.register(literal("get")
                    .then(argument("item", StringArgumentType.word())
                            .suggests((context, builder) -> {
                                // Complete after a plus too, so a list can be
                                // typed the same way a single name is.
                                String typed = builder.getRemaining()
                                        .toLowerCase(java.util.Locale.ROOT);
                                int plus = typed.lastIndexOf('+');
                                String done = plus < 0 ? "" : typed.substring(0, plus + 1);
                                String partial = typed.substring(plus + 1);
                                for (String item : Planner.obtainable()) {
                                    if (item.startsWith(partial)) builder.suggest(done + item);
                                }
                                return builder.buildFuture();
                            })
                            .executes(context -> get(context.getSource(),
                                    StringArgumentType.getString(context, "item"), 1))
                            .then(argument("count", IntegerArgumentType.integer(1, 4096))
                                    .executes(context -> get(context.getSource(),
                                            StringArgumentType.getString(context, "item"),
                                            IntegerArgumentType.getInteger(context, "count"))))));

            // Explicit, never automatic. An item gets one enchant at a table
            // ever, so this is the one thing in the mod whose mistakes cannot
            // be undone — which is exactly why it should be asked for.
            // An objective rather than a task. Everything else in this mod is
            // something to do; this is something to have achieved, and it works
            // out the doing for itself.
            // The control panel. Off until asked for, on the loopback address
            // unless asked otherwise, and a fresh token every time.
            // Pasting rather than building. Same menu, same drag, same Enter —
            // and then the whole thing is simply there, with no materials and
            // no walking, because the server put it there rather than the
            // character. See PasteTask for what that costs and where it works.
            dispatcher.register(literal("paste")
                    .executes(context -> paste(context.getSource()))
                    .then(literal("undo").executes(context -> undoPaste(context.getSource())))
                    .then(literal("stop").executes(context -> stop(context.getSource()))));

            // One command both ways. A portal in the Nether leads home and one
            // at home leads to the Nether, so which you get is decided by where
            // you are standing rather than by what you typed.
            dispatcher.register(literal("nether")
                    .executes(context -> {
                        UnderstudyClient.throughAPortal();
                        return 1;
                    })
                    .then(literal("stop").executes(context -> stop(context.getSource()))));

            dispatcher.register(literal("panel")
                    .executes(context -> panel(context.getSource(), false))
                    .then(literal("network").executes(context -> panel(context.getSource(), true)))
                    .then(literal("open").executes(context -> reopen(context.getSource())))
                    .then(literal("off").executes(context -> panelOff(context.getSource()))));

            dispatcher.register(literal("project")
                    .executes(context -> projects(context.getSource()))
                    .then(argument("which", StringArgumentType.word())
                            .suggests((context, builder) -> {
                                String typed = builder.getRemaining()
                                        .toLowerCase(java.util.Locale.ROOT);
                                for (String id : Project.ids()) {
                                    if (id.startsWith(typed)) builder.suggest(id);
                                }
                                return builder.buildFuture();
                            })
                            .executes(context -> project(context.getSource(),
                                    StringArgumentType.getString(context, "which")))));

            dispatcher.register(literal("enchant")
                    .executes(context -> enchant(context.getSource(), null))
                    .then(argument("item", StringArgumentType.word())
                            .suggests((context, builder) -> {
                                String typed = builder.getRemaining()
                                        .toLowerCase(java.util.Locale.ROOT);
                                for (String item : Carried.contents(
                                        Minecraft.getInstance().player).keySet()) {
                                    if (item.startsWith(typed)
                                            && dev.understudy.core.craft.Enchanting
                                                    .worthEnchanting(item)) {
                                        builder.suggest(item);
                                    }
                                }
                                return builder.buildFuture();
                            })
                            .executes(context -> enchant(context.getSource(),
                                    StringArgumentType.getString(context, "item")))));

            dispatcher.register(literal("sort")
                    .executes(context -> sort(context.getSource(), true))
                    .then(literal("all").executes(context -> sort(context.getSource(), false)))
                    .then(literal("stop").executes(context -> stop(context.getSource()))));

            // A chest of spares, for the walk back from a respawn. Nothing
            // here is a command sent to the server and nothing needs
            // permission: it holds a chest, right-clicks the ground and
            // shift-clicks stacks across, which is what a player does.
            dispatcher.register(literal("stash")
                    .executes(context -> stash(context.getSource(),
                            dev.understudy.core.gear.Kit.RECOVERY, A_STACK, false))
                    .then(literal("where").executes(context -> stashWhere(context.getSource())))
                    .then(literal("needs")
                            .executes(context -> stashNeeds(context.getSource(),
                                    dev.understudy.core.gear.Kit.RECOVERY))
                            .then(argument("kit", StringArgumentType.word())
                                    .suggests((context, builder) -> {
                                        for (String kit : dev.understudy.core.gear.Kit.presets()) {
                                            builder.suggest(kit);
                                        }
                                        return builder.buildFuture();
                                    })
                                    .executes(context -> stashNeeds(context.getSource(),
                                            StringArgumentType.getString(context, "kit")))))
                    .then(literal("stop").executes(context -> stop(context.getSource())))
                    // A kit by name, or anything at all by name and number.
                    // Same plus-separated shape as /get, because a chest with
                    // one thing in it is rarely the chest anyone wanted.
                    .then(argument("what", StringArgumentType.word())
                            .suggests((context, builder) -> {
                                String typed = builder.getRemaining()
                                        .toLowerCase(java.util.Locale.ROOT);
                                int plus = typed.lastIndexOf('+');
                                String done = plus < 0 ? "" : typed.substring(0, plus + 1);
                                String partial = typed.substring(plus + 1);
                                if (plus < 0) {
                                    for (String kit : dev.understudy.core.gear.Kit.presets()) {
                                        if (kit.startsWith(partial)) builder.suggest(kit);
                                    }
                                }
                                for (String item : Planner.obtainable()) {
                                    if (item.startsWith(partial)) builder.suggest(done + item);
                                }
                                return builder.buildFuture();
                            })
                            .executes(context -> stash(context.getSource(),
                                    StringArgumentType.getString(context, "what"), A_STACK, false))
                            .then(argument("n", IntegerArgumentType.integer(1, 6400))
                                    .executes(context -> stash(context.getSource(),
                                            StringArgumentType.getString(context, "what"),
                                            IntegerArgumentType.getInteger(context, "n"), true)))));

            dispatcher.register(literal("understudy")
                    .then(literal("stop").executes(context -> stop(context.getSource())))
                    .then(literal("pause").executes(context -> pause(context.getSource())))
                    .then(literal("resume").executes(context -> resume(context.getSource())))
                    .then(literal("status").executes(context -> status(context.getSource())))
                    .then(literal("profile").executes(context -> profile(context.getSource())))
                    .then(literal("help")
                            .executes(context -> help(context.getSource(), null))
                            .then(argument("topic", StringArgumentType.word())
                                    .suggests((context, builder) -> {
                                        String typed = builder.getRemaining()
                                        .toLowerCase(java.util.Locale.ROOT);
                                        for (String id : Manual.topics()) {
                                            if (id.startsWith(typed)) builder.suggest(id);
                                        }
                                        return builder.buildFuture();
                                    })
                                    .executes(context -> help(context.getSource(),
                                            StringArgumentType.getString(context, "topic")))))
                    .then(literal("chatfix").executes(context ->
                            guarded(context.getSource(), "understudy chatfix",
                                    () -> chatFix(context.getSource()))))
                    .then(literal("test").executes(context ->
                            guarded(context.getSource(), "understudy test",
                                    () -> selfTest(context.getSource()))))
                    .then(literal("hud").executes(context -> toggleHud(context.getSource())))
                    .then(literal("why").executes(context -> why(context.getSource())))
                    .then(literal("auto")
                            .executes(context -> auto(context.getSource(), null, 0))
                            .then(literal("off").executes(context -> autoOff(context.getSource())))
                            .then(argument("what", StringArgumentType.word())
                                    .executes(context -> auto(context.getSource(),
                                            StringArgumentType.getString(context, "what"), 16))
                                    .then(argument("count", IntegerArgumentType.integer(1, 2304))
                                            .executes(context -> auto(context.getSource(),
                                                    StringArgumentType.getString(context, "what"),
                                                    IntegerArgumentType.getInteger(context, "count"))))))
                    .then(literal("atlas").executes(context -> atlas(context.getSource())))
                    .then(literal("timing").executes(context -> timing(context.getSource())))
                    .then(literal("speed")
                            .executes(context -> speed(context.getSource(), null))
                            .then(argument("how", StringArgumentType.word())
                                    .executes(context -> speed(context.getSource(),
                                            StringArgumentType.getString(context, "how")))))
                    // Bare /understudy lists the commands rather than the
                    // status: someone typing it is usually asking what exists.
                    .executes(context -> help(context.getSource(), null)));
        });
    }

    private static int travel(FabricClientCommandSource source, int x, int y, int z) {
        // Asking for new work is as clear a resume as there is.
        UnderstudyClient.resume();
        TravelTask task = UnderstudyClient.travel();
        if (task == null) {
            say(source, "not in a world yet");
            return 0;
        }
        task.start(new BlockPos(x, y, z));
        say(source, "heading for " + x + ", " + y + ", " + z);
        return 1;
    }

    /**
     * Design a structure and either report what it needs or go and build it.
     *
     * The same code path for both, because "tell me what this costs" and "build
     * this" should never disagree about what the thing is.
     */
    private static int build(FabricClientCommandSource source, String what, int size, boolean planOnly) {
        // Asking for new work is as clear a resume as there is.
        UnderstudyClient.resume();
        BuildTask task = UnderstudyClient.build();
        PlayerProfile profile = UnderstudyClient.profile();
        if (task == null || profile == null) {
            say(source, "not in a world yet");
            return 0;
        }

        Catalog.Entry found = Catalog.byId(what.toLowerCase());
        if (found == null && what.equalsIgnoreCase("shelter")) found = Catalog.byId("hut");
        if (found == null && what.equalsIgnoreCase("chests")) found = Catalog.byId("storage");
        if (found == null) {
            say(source, "I can build: " + String.join(", ", Catalog.ids()));
            return 0;
        }
        final Catalog.Entry entry = found;
        Materials.Wood wood = Materials.woodNamed(profile.favouriteWood());
        Materials.Stone stone = Materials.stoneNamed("stone brick");
        // What you actually build with wins over the default, which is the
        // whole point of watching: a base of deepslate should not get an oak
        // house dropped in the middle of it. Only the flat surfaces move — the
        // shaped pieces have to stay in a family that has stairs and slabs.
        Map<Blueprint.Role, String> palette =
                Designs.paletteFrom(profile.buildingBlocks(6), Designs.paletteOf(wood, stone));
        Blueprint blueprint = Catalog.build(entry, size, wood, stone, palette);

        say(source, blueprint.name() + ": " + blueprint.blockCount() + " blocks");

        // The real plan against the real inventory, rather than a list of what
        // is missing. Knowing you are short of glass is less useful than being
        // told the sand is twenty seconds away and the furnace is not built yet.
        Map<String, Integer> carrying = Carried.contents(source.getPlayer());
        Planner.Plan plan = new Planner(Catalogue.solver(), UnderstudyClient.measured())
                .plan(blueprint.essentialMaterials(), carrying);

        if (plan.actions().isEmpty() && plan.possible()) {
            say(source, "everything needed is already in your inventory");
        } else {
            say(source, String.format("to gather and craft: about %s",
                    plan.seconds() < 90
                            ? Math.round(plan.seconds()) + " seconds"
                            : Math.round(plan.seconds() / 60) + " minutes"));
            for (String line : plan.summary()) say(source, "  " + line);
        }
        if (!plan.possible()) {
            say(source, "no way to get: " + String.join(", ", plan.shortfall().keySet()));
            if (!planOnly) return 0;
        }

        if (planOnly) return 1;

        if (UnderstudyClient.travel() != null && UnderstudyClient.travel().running()) {
            say(source, "busy travelling — /understudy stop first");
            return 0;
        }
        // Named on the command line or picked from the menu, where it goes is
        // the same question and gets the same answer: drag out the plot and
        // look at it before a single block is placed. Dropping it two blocks
        // diagonally from your feet was quick to write and put a great many
        // houses through the side of a hill.
        UnderstudyClient.siteFor(Sized.of(blueprint,
                n -> Catalog.build(entry, n, wood, stone, palette),
                entry.minSize(), entry.maxSize()));
        return 1;
    }

    /**
     * Enchant something, or say why not.
     *
     * With no name it takes the best tool or weapon being carried, which is
     * almost always what was meant — and which is also the item you would least
     * like it to get wrong, so everything it does is announced first.
     */
    /**
     * Open the menu, and put whatever is chosen straight into the world.
     *
     * The only difference from /build is what happens after Enter, so it is the
     * same two screens and the same keys, and nothing new to learn.
     */
    private static int paste(FabricClientCommandSource source) {
        UnderstudyClient.resume();
        if (source.getPlayer() == null) {
            say(source, "not in a world yet");
            return 0;
        }
        UnderstudyClient.askForPicker(true);
        if (Minecraft.getInstance().getSingleplayerServer() == null) {
            // Said before rather than after. The two routes feel different
            // enough — one is instant, one is a character walking a house up —
            // that finding out which you are getting after choosing a design is
            // finding out too late. Free to ask: the permissions came with the
            // login, so this costs no packet and no refusal in the chat.
            boolean mayCommand = source.getPlayer().permissions()
                    .hasPermission(net.minecraft.server.permissions
                            .Permissions.COMMANDS_GAMEMASTER);
            if (mayCommand) {
                say(source, "you are an operator here, so it goes straight in");
            } else if (dev.understudy.mc.Hotbar.creative(source.getPlayer())) {
                say(source, "not an operator here — but creative, so it is built block by "
                        + "block at instant speed instead, which costs nothing but the walk");
            } else {
                // Said now rather than after a design has been chosen and a
                // plot dragged out. Survival plus no permission is the one
                // combination with no answer, and pretending otherwise wastes
                // more of your time than the refusal does.
                say(source, "§enot an operator here and not in creative — a paste cannot "
                        + "happen: blocks come from the server and it will not make them");
                say(source, "creative on that server does it, and is far less to hand out "
                        + "than op. Otherwise /build puts it up with materials.");
            }
        }
        return 1;
    }

    /** Take the last paste away again. */
    private static int undoPaste(FabricClientCommandSource source) {
        PasteTask task = UnderstudyClient.paste();
        if (task == null) {
            say(source, "not in a world yet");
            return 0;
        }
        UnderstudyClient.resume();
        task.undo();
        return 1;
    }

    private static int enchant(FabricClientCommandSource source, String rawItem) {
        UnderstudyClient.resume();
        EnchantTask task = UnderstudyClient.enchant();
        if (task == null || source.getPlayer() == null) {
            say(source, "not in a world yet");
            return 0;
        }
        String item = rawItem == null
                ? bestWorthEnchanting(Carried.contents(source.getPlayer()))
                : rawItem.toLowerCase().replace("minecraft:", "");
        if (item == null) {
            say(source, "nothing on you is worth an enchant");
            return 0;
        }
        return task.start(item) ? 1 : 0;
    }

    /** The dearest thing in the bag a table would do something for. */
    private static String bestWorthEnchanting(Map<String, Integer> carried) {
        String best = null;
        double bestWorth = 0;
        for (String item : carried.keySet()) {
            if (!dev.understudy.core.craft.Enchanting.worthEnchanting(item)) continue;
            double worth = dev.understudy.core.survive.Combat.dpsOf(item)
                    + (item.startsWith("netherite_") ? 20 : item.startsWith("diamond_") ? 15
                            : item.startsWith("iron_") ? 8 : 1);
            if (worth > bestWorth) {
                bestWorth = worth;
                best = item;
            }
        }
        return best;
    }

    /** What it can be given, with how far along each already is. */
    private static int projects(FabricClientCommandSource source) {
        Autopilot autopilot = UnderstudyClient.autopilot();
        if (autopilot != null && !autopilot.progress().isEmpty()) {
            for (String line : autopilot.progress()) say(source, line);
            return 1;
        }
        say(source, "give it something to achieve:");
        for (Project.Plan plan : Project.all()) {
            say(source, "  /project " + plan.id() + " — " + plan.name());
            say(source, "      " + plan.summary());
        }
        return 1;
    }

    /**
     * Hand it an objective and let it work out the steps.
     *
     * It reports what is already true before it starts, which is both the
     * honest thing and the useful one: a project half-done by hand should say
     * so rather than quietly skipping four steps.
     */
    private static int project(FabricClientCommandSource source, String which) {
        UnderstudyClient.resume();
        Autopilot autopilot = UnderstudyClient.autopilot();
        if (autopilot == null || source.getPlayer() == null) {
            say(source, "not in a world yet");
            return 0;
        }
        Project.Plan plan = Project.byId(which);
        if (plan == null) {
            say(source, "no project called " + which + " — " + String.join(", ", Project.ids()));
            return 0;
        }
        autopilot.start(plan);
        return 1;
    }

    /**
     * Start the panel and hand over the address.
     *
     * The token is in the link, so opening it is the whole of getting in and
     * there is nothing to type. It is regenerated every time this is run, which
     * means an address shared and regretted stops working the moment the panel
     * is restarted.
     */
    private static int panel(FabricClientCommandSource source, boolean toTheNetwork) {
        if (!Remote.start(toTheNetwork, line -> say(source, line))) return 0;
        // Opened rather than printed. Minecraft's chat cannot be copied from,
        // so a link there is a link retyped by hand — which is exactly how the
        // first version of this went, and it is not a small annoyance when
        // twelve characters of it are a token.
        Remote.openInBrowser(line -> say(source, line));
        say(source, "opening it in your browser now");
        if (toTheNetwork) {
            say(source, "on your phone: " + Remote.networkAddress());
        } else {
            say(source, "only this machine can reach it; /panel network opens it to your house");
        }
        say(source, "if nothing opened, the link is in config/understudy/panel-url.txt");
        return 1;
    }

    /** Open it again without restarting it, so the token stays the same. */
    private static int reopen(FabricClientCommandSource source) {
        if (!Remote.running()) return panel(source, false);
        Remote.openInBrowser(line -> say(source, line));
        say(source, "opening " + Remote.address());
        return 1;
    }

    private static int panelOff(FabricClientCommandSource source) {
        Remote.stop(line -> say(source, line));
        return 1;
    }

    private static int openPicker(FabricClientCommandSource source) {
        // Asking for new work is as clear a resume as there is.
        UnderstudyClient.resume();
        if (Minecraft.getInstance().player == null) {
            say(source, "not in a world yet");
            return 0;
        }
        // Asked for, not opened here. A command runs while the chat screen is
        // still up, and chat closes itself afterwards by setting the screen to
        // null — which would shut the picker the moment it appeared.
        UnderstudyClient.askForPicker();
        return 1;
    }

    private static int cancelSite(FabricClientCommandSource source) {
        UnderstudyClient.cancelSite();
        return 1;
    }

    /**
     * Fetch a thing, however many levels deep it turns out to be.
     *
     * Nothing new underneath: the planner already worked out that iron means a
     * stone pickaxe means cobblestone means a wooden pickaxe means a log, and
     * the gatherer already knows how to go and do each step. This is the door.
     */
    private static int get(FabricClientCommandSource source, String rawItem, int count) {
        return getFor(line -> say(source, line), source.getPlayer(), rawItem, count);
    }

    /**
     * The whole of /get, with somewhere to report to.
     *
     * Split out so the panel runs the same code rather than its own copy of it.
     * Two ways to ask for the same thing that plan it differently is the sort
     * of difference nobody finds until it matters.
     */
    public static int getFor(java.util.function.Consumer<String> say, LocalPlayer player,
                             String rawItem, int count) {
        // Asking for new work is as clear a resume as there is.
        UnderstudyClient.resume();
        GatherTask gather = UnderstudyClient.gather();
        if (gather == null || player == null) {
            say.accept("not in a world yet");
            return 0;
        }
        // Several things at once, joined with a plus. Not a convenience: the
        // planner costs them together, so the pickaxe, the crafting table and
        // the trip underground that iron and coal both need are paid for once
        // instead of twice. Asking for them one at a time is two trips down the
        // same tunnel.
        java.util.LinkedHashMap<String, Integer> wants = new java.util.LinkedHashMap<>();
        for (String each : rawItem.toLowerCase(java.util.Locale.ROOT)
                .replace("minecraft:", "").split("\\+")) {
            if (!each.isBlank()) wants.merge(each, count, Integer::sum);
        }
        if (wants.isEmpty()) {
            say.accept("nothing named");
            return 0;
        }
        String item = String.join(" and ", wants.keySet());

        Map<String, Integer> have = Carried.contents(player);
        Planner.Plan plan = new Planner(Catalogue.solver(), UnderstudyClient.measured()).plan(wants, have);

        // Anything with a depth means a tunnel, and a tunnel at y=-59 is pitch
        // black and full of things that spawn in it. Asking for torches in the
        // same breath costs a stick and a coal and is the difference between
        // coming back with diamonds and the guardian aborting over a skeleton.
        if (plan.possible() && goesUnderground(plan) && !have.containsKey("torch")) {
            // Torches first, literally: the planner emits goals in the order it
            // is given them, and torches made after the dig they were for are
            // no use to anybody.
            java.util.LinkedHashMap<String, Integer> lit = new java.util.LinkedHashMap<>();
            lit.put("torch", TORCHES_FOR_A_DIG);
            lit.putAll(wants);
            Planner.Plan withLight = new Planner(Catalogue.solver(), UnderstudyClient.measured()).plan(lit, have);
            if (withLight.possible()) plan = withLight;
        }

        if (!plan.possible()) {
            say.accept("no way to get " + String.join(", ", plan.shortfall().keySet())
                    + " — /get with no name lists what it can");
            return 0;
        }
        if (plan.actions().isEmpty()) {
            say.accept("you already have " + count + " " + item);
            return 1;
        }

        say.accept(String.format("%d %s: %s", count, item,
                plan.seconds() < 90
                        ? Math.round(plan.seconds()) + " seconds"
                        : Math.round(plan.seconds() / 60) + " minutes"));
        for (String line : plan.summary()) say.accept("  " + line);
        gather.start(plan, null);
        return 1;
    }

    /** Enough to light a few hundred blocks of tunnel at eight-block spacing. */
    private static final int TORCHES_FOR_A_DIG = 24;

    private static boolean goesUnderground(Planner.Plan plan) {
        return plan.actions().stream()
                .anyMatch(action -> action instanceof Planner.Collect collect
                        && collect.bestY() != dev.understudy.core.craft.Gather.ANYWHERE);
    }

    private static int sort(FabricClientCommandSource source, boolean keepKit) {
        // Asking for new work is as clear a resume as there is.
        UnderstudyClient.resume();
        SortTask task = UnderstudyClient.sort();
        if (task == null) {
            say(source, "not in a world yet");
            return 0;
        }
        task.start(keepKit);
        return 1;
    }

    /**
     * How many of something you get by not saying how many.
     *
     * A stack. It is the amount people mean by "some" for anything that
     * stacks, and for anything that does not the game caps it at one on the
     * way past, so there is no number here that is wrong for both.
     */
    private static final int A_STACK = 64;

    /**
     * Put a chest down here and fill it.
     *
     * `what` is either the name of a kit — a list the mod knows, with its own
     * amounts and its own rules about what has to stay with you — or the name
     * of anything at all, in which case the number is yours and nothing is
     * held back. Naming a thing is choosing it; a kit you did not write the
     * contents of is the only case where second-guessing you is right.
     */
    private static int stash(FabricClientCommandSource source, String what, int count,
                             boolean saidHowMany) {
        UnderstudyClient.resume();
        StashTask task = UnderstudyClient.stash();
        if (task == null) {
            say(source, "not in a world yet");
            return 0;
        }
        java.util.List<dev.understudy.core.gear.Kit.Line> kit =
                dev.understudy.core.gear.Kit.preset(what);
        if (kit != null) {
            if (saidHowMany) {
                say(source, what + " is a kit — its amounts come with it, so the "
                        + count + " was ignored");
            }
            task.start(kit, what + " chest", true);
            return 1;
        }
        java.util.List<dev.understudy.core.gear.Kit.Line> order =
                dev.understudy.core.gear.Kit.order(what, count);
        if (order.isEmpty()) {
            say(source, "nothing named — /stash <item> [n], or one of: "
                    + String.join(", ", dev.understudy.core.gear.Kit.presets()));
            return 0;
        }
        String named = order.size() == 1
                ? order.getFirst().item()
                : order.size() + " things";
        task.start(order, "chest of " + named, false);
        return 1;
    }

    /**
     * Where the ones it has put down are.
     *
     * The atlas keeps them per world and across sessions, which is the only
     * version of this feature worth having — a cache you have to remember the
     * coordinates of yourself is a cache you wrote on a sticky note.
     */
    private static int stashWhere(FabricClientCommandSource source) {
        StashTask task = UnderstudyClient.stash();
        if (task == null) {
            say(source, "not in a world yet");
            return 0;
        }
        java.util.List<String> found = task.where();
        if (found.isEmpty()) {
            say(source, "no stashes in this world yet — /stash puts one here");
            return 1;
        }
        say(source, found.size() == 1 ? "one stash:" : found.size() + " stashes, nearest first:");
        for (String line : found) say(source, "  " + line);
        return 1;
    }

    /** What to be carrying for a full kit, spare and kept side by side. */
    private static int stashNeeds(FabricClientCommandSource source, String which) {
        java.util.List<dev.understudy.core.gear.Kit.Line> kit =
                dev.understudy.core.gear.Kit.preset(which);
        if (kit == null) {
            say(source, "no kit called " + which + " — there is "
                    + String.join(" and ", dev.understudy.core.gear.Kit.presets()));
            return 0;
        }
        say(source, "a full " + which + " chest needs, on you, one chest and:");
        for (dev.understudy.core.gear.Kit.Line line : kit) {
            say(source, "  " + (line.want() + line.keepBack()) + " " + line.item()
                    + "  —  " + line.want() + " for the chest, " + line.keepBack() + " stays");
        }
        say(source, "in creative it needs none of it: the chest is stocked in full");
        say(source, "or name your own: /stash " + kit.getFirst().item() + " 64");
        return 1;
    }

    private static int stop(FabricClientCommandSource source) {
        UnderstudyClient.stopAll();
        say(source, "stopped — everything, and the keys are yours");
        return 1;
    }

    private static int pause(FabricClientCommandSource source) {
        if (UnderstudyClient.paused()) {
            say(source, "already paused — /understudy resume to carry on");
            return 1;
        }
        UnderstudyClient.pause();
        say(source, "paused, holding its place — /understudy resume");
        return 1;
    }

    private static int resume(FabricClientCommandSource source) {
        if (!UnderstudyClient.paused()) {
            say(source, "not paused");
            return 1;
        }
        UnderstudyClient.resume();
        say(source, "carrying on");
        return 1;
    }

    private static int status(FabricClientCommandSource source) {
        if (UnderstudyClient.paused()) say(source, "§epaused — /understudy resume");
        TravelTask travel = UnderstudyClient.travel();
        BuildTask build = UnderstudyClient.build();
        SortTask sort = UnderstudyClient.sort();
        StashTask stash = UnderstudyClient.stash();
        if (travel == null) {
            say(source, "idle");
            return 1;
        }
        // Gathering first, and hunting before that. A gather is the thing that
        // runs longest and starts everything else, and this used to answer
        // "idle" throughout one — which is the single most confusing thing a
        // status command can say while the character is visibly digging.
        HuntTask hunt = UnderstudyClient.hunt();
        GatherTask gather = UnderstudyClient.gather();
        if (hunt != null && hunt.running()) say(source, hunt.status());
        else if (gather != null && gather.running()) say(source, gather.status());
        else if (travel.running()) say(source, travel.status());
        else if (build != null && build.running()) say(source, build.status());
        else if (sort != null && sort.running()) say(source, sort.status());
        else if (stash != null && stash.running()) say(source, stash.status());
        else say(source, "idle");
        return 1;
    }

    /**
     * Put the chat settings right.
     *
     * Reports what it changed rather than what it tried, because the whole
     * point is that you cannot currently trust what you are being shown.
     */
    private static int chatFix(FabricClientCommandSource source) {
        Minecraft client = Minecraft.getInstance();
        ChatFix.Result result = ChatFix.repair(client);
        if (!result.changedAnything()) {
            say(source, "every chat setting is already right:");
            for (String line : ChatFix.describe(client)) say(source, "  " + line);
            // Being told "nothing was wrong" and left there is what made this
            // command feel like it was fixing something other than the problem.
            // If the settings are fine then the problem is one of two other
            // things, and both are worth naming.
            say(source, "so if you still cannot read what I say, it is one of these:");
            say(source, "  other players missing — the server, not your client");
            say(source, "  my own lines cut off — long ones are trimmed to the "
                    + "window now, and the whole line is always in chat");
            return 1;
        }
        say(source, "fixed:");
        for (String change : result.changed()) say(source, "  " + change);
        say(source, "saved to options.txt — this sticks across restarts");
        return 1;
    }

    /** Check every part the mod needs and report which one is broken. */
    private static int selfTest(FabricClientCommandSource source) {
        List<String> results = SelfTest.run(Minecraft.getInstance());
        Hud.clear();
        for (String line : results) {
            say(source, line);
            if (line.startsWith("FAIL") || line.startsWith("WARN")) Hud.warn(line);
            else Hud.say(line);
        }
        say(source, "this is also in .minecraft/logs/latest.log");
        return 1;
    }

    private static int toggleHud(FabricClientCommandSource source) {
        Hud.setEnabled(!Hud.enabled());
        say(source, "overlay " + (Hud.enabled() ? "on" : "off"));
        return 1;
    }

    /**
     * What is in the import folder, and what is wrong with it.
     *
     * "It does not import" has two completely different causes — the files are
     * somewhere else, or they are here and unreadable — and from the outside
     * they look identical: a menu with nothing new in it. This prints the path
     * it actually looks in and its verdict on every file there, so the answer
     * takes one command instead of a guess.
     */
    private static int imports(FabricClientCommandSource source) {
        Path folder = Imports.folder();
        say(source, "import folder: " + folder.toAbsolutePath());

        List<Path> files;
        try {
            Files.createDirectories(folder);
            try (var all = Files.list(folder)) {
                files = all.filter(Files::isRegularFile).toList();
            }
        } catch (IOException error) {
            say(source, "§ccannot read that folder: " + error.getMessage());
            return 0;
        }

        if (files.isEmpty()) {
            say(source, "nothing in it yet — drop a .obj, .stl, .litematic, .schem or .nbt in there");
            return 1;
        }
        for (Path file : files) {
            String name = file.getFileName().toString();
            if (!Imports.importable(name.toLowerCase(java.util.Locale.ROOT))) {
                say(source, "§8· " + name + " — not a format it reads");
                continue;
            }
            try {
                long size = Files.size(file);
                if (size > 16L * 1024 * 1024) {
                    say(source, "§c· " + name + " — too big (" + (size / 1048576) + " MB, limit 16)");
                } else if (Imports.isModel(file)) {
                    say(source, "§a· " + name + " — 3D model, ready (pick a height in /build)");
                } else {
                    Schematic.Result result = Imports.load(file);
                    say(source, "§a· " + name + " — "
                            + result.blueprint().blockCount() + " blocks, ready");
                }
            } catch (Exception error) {
                say(source, "§c· " + name + " — " + error.getClass().getSimpleName()
                        + ": " + error.getMessage());
            }
        }
        say(source, "everything marked ready appears at the top of /build");
        return 1;
    }

    private static int speed(FabricClientCommandSource source, String how) {
        if (how == null) {
            for (BuildTask.Speed option : BuildTask.Speed.values()) {
                say(source, (option == BuildTask.speed() ? "§a· " : "§8· ")
                        + option.name().toLowerCase(java.util.Locale.ROOT).replace('_', ' ')
                        + " — " + option.describe + ", " + option.pace());
            }
            // The gap between three and a hundred and sixty is the head, not a
            // counter, and saying so is the difference between a setting people
            // understand and one they assume is broken.
            say(source, "the two slow ones turn to look at each block, which is "
                    + "what the rate is; the other two do not");
            say(source, "instant also works out of turn to save walking — but the "
                    + "walking is what is left, and it is most of a build");
            say(source, "/understudy speed <steady|brisk|flat_out|instant>");
            return 1;
        }
        for (BuildTask.Speed option : BuildTask.Speed.values()) {
            if (option.name().equalsIgnoreCase(how.replace(' ', '_'))) {
                BuildTask.speed(option);
                say(source, "building " + option.describe + " — " + option.pace());
                if (option == BuildTask.Speed.INSTANT) {
                    // Said every time it is chosen, because the name promises
                    // something the rules do not allow and finding that out by
                    // watching it walk would be worse.
                    say(source, "placing is instant; walking is not — every block "
                            + "still has to be within reach, and that is most of the time");
                }
                return 1;
            }
        }
        say(source, "no such speed — steady, brisk, flat_out or instant");
        return 0;
    }

    /**
     * What it thinks is going on, and what it would do about it.
     *
     * A decision you cannot interrogate is indistinguishable from a bug. This
     * is the difference between trusting the thing and watching it: when it
     * walks off mid-build, this says whether that was hunger, a skeleton, or a
     * full inventory.
     */
    /**
     * Let it get on with things.
     *
     * With no argument it keeps itself going — a pickaxe, torches, and putting
     * things away when it runs out of room. With an item it works toward that
     * as well. It will not do anything outside that list, which is the point:
     * an autopilot that improvises is one you never leave running.
     */
    private static int auto(FabricClientCommandSource source, String what, int count) {
        Autopilot autopilot = UnderstudyClient.autopilot();
        if (autopilot == null) {
            say(source, "not in a world yet");
            return 0;
        }
        UnderstudyClient.resume();
        autopilot.start(what == null ? null : what.toLowerCase().replace("minecraft:", ""), count);
        return 1;
    }

    private static int autoOff(FabricClientCommandSource source) {
        Autopilot autopilot = UnderstudyClient.autopilot();
        if (autopilot != null) autopilot.stop();
        return 1;
    }

    private static int why(FabricClientCommandSource source) {
        LocalPlayer player = Minecraft.getInstance().player;
        if (player == null || Minecraft.getInstance().level == null) {
            say(source, "not in a world yet");
            return 0;
        }
        // Asked of whatever is running, which is the only thing that knows what
        // it still needs. Naming the job in a string here — which is what this
        // used to do — is why the agenda's "go and make a pickaxe" branch had
        // never once fired in a real game.
        Agenda.Job job = UnderstudyClient.currentJob();

        Agenda.Situation now = Senses.read(Minecraft.getInstance(), player, job,
                UnderstudyClient.damageRecently());
        for (String line : UnderstudyClient.agenda().reasoning(now)) {
            say(source, line);
        }
        // And, when there is one, the fight — which is a separate question with
        // its own reasoning, and the one you most want to interrogate, because
        // it is the one whose wrong answer gets you killed.
        String fight = Fight.describe();
        if (!fight.isEmpty()) say(source, "fight: " + fight);
        return 1;
    }


    /**
     * Where the time went, so "too slow" becomes something to fix.
     *
     * Twenty minutes of mining is the game's own speed and nothing to do about
     * it; twenty minutes of walking between blocks is a bug worth a day. From
     * the outside they are the same twenty minutes.
     */
    private static int timing(FabricClientCommandSource source) {
        say(source, "the last job:");
        for (String line : UnderstudyClient.jobTimings().summary()) say(source, "  " + line);
        say(source, "this session:");
        for (String line : UnderstudyClient.timings().summary()) say(source, "  " + line);
        // And what it has learned things really cost here, which is the other
        // half of the same question: where the time goes, and how much of it
        // the estimates were expecting.
        say(source, "what things cost in this world:");
        for (String line : UnderstudyClient.measured().summary()) say(source, line);
        return 1;
    }

    /** Everywhere it has seen anything, which is the part a person cannot do. */
    private static int atlas(FabricClientCommandSource source) {
        Map<String, Integer> seen = UnderstudyClient.atlas().summary();
        if (seen.isEmpty()) {
            say(source, "nothing remembered yet — it fills up as it looks around");
            return 1;
        }
        say(source, UnderstudyClient.atlas().size() + " places remembered:");
        seen.entrySet().stream()
                .sorted((a, b) -> Integer.compare(b.getValue(), a.getValue()))
                .limit(12)
                .forEach(entry -> say(source, "  " + entry.getValue() + " x " + entry.getKey()));
        return 1;
    }

    /**
     * What the panel asked for, done here on the client thread.
     *
     * A switch over a validated verb rather than a command string: there is no
     * text anywhere in this path, so there is nothing to inject into. Every arm
     * calls the same thing the matching command does, which is the point — two
     * ways to ask for something that behave differently is a difference nobody
     * finds until it matters.
     */
    public static void remote(Command.Action action) {
        Minecraft client = Minecraft.getInstance();
        LocalPlayer player = client.player;
        if (player == null) return;
        java.util.function.Consumer<String> say = UnderstudyClient::tell;

        switch (action.what()) {
            case STOP -> UnderstudyClient.stopAll("stopped from the panel");
            case PAUSE -> UnderstudyClient.pause();
            case RESUME -> UnderstudyClient.resume();
            case GET -> getFor(say, player, action.name(), action.count());
            case SORT -> {
                UnderstudyClient.resume();
                if (UnderstudyClient.sort() != null) UnderstudyClient.sort().start(true);
            }
            case TRAVEL -> {
                UnderstudyClient.resume();
                if (UnderstudyClient.travel() != null) {
                    UnderstudyClient.travel().start(
                            new BlockPos(action.x(), action.y(), action.z()));
                }
            }
            case PROJECT -> {
                Project.Plan plan = Project.byId(action.name());
                if (plan == null) say.accept("no project called " + action.name());
                else if (UnderstudyClient.autopilot() != null) {
                    UnderstudyClient.resume();
                    UnderstudyClient.autopilot().start(plan);
                }
            }
            case BUILD -> {
                Catalog.Entry entry = Catalog.byId(action.name());
                BuildTask task = UnderstudyClient.build();
                if (entry == null || task == null) {
                    say.accept("no design called " + action.name());
                } else {
                    UnderstudyClient.resume();
                    int size = action.count() > 0 ? action.count() : entry.defaultSize();
                    Materials.Wood wood = Materials.woodNamed(
                            UnderstudyClient.profile().favouriteWood());
                    task.start(Catalog.build(entry, size, wood,
                                    Materials.stoneNamed("stone brick")),
                            player.blockPosition().offset(3, 0, 3));
                }
            }
            case AUTO -> {
                if (UnderstudyClient.autopilot() != null) {
                    UnderstudyClient.resume();
                    UnderstudyClient.autopilot().start(action.name(),
                            Math.max(1, action.count()));
                }
            }
            case AUTO_OFF -> {
                if (UnderstudyClient.autopilot() != null) UnderstudyClient.autopilot().stop();
            }
            case ENCHANT -> {
                EnchantTask task = UnderstudyClient.enchant();
                if (task == null) return;
                UnderstudyClient.resume();
                String item = action.name().isEmpty()
                        ? bestWorthEnchanting(Carried.contents(player)) : action.name();
                if (item == null) say.accept("nothing on you is worth an enchant");
                else task.start(item);
            }
            case SPEED -> {
                for (BuildTask.Speed speed : BuildTask.Speed.values()) {
                    if (speed.name().equalsIgnoreCase(action.name())) {
                        BuildTask.speed(speed);
                        say.accept("building " + speed.describe);
                    }
                }
            }
            case HUD -> {
                Hud.setEnabled(!Hud.enabled());
                say.accept("overlay " + (Hud.enabled() ? "on" : "off"));
            }
        }
    }

    /**
     * The command list, a section at a time.
     *
     * All of it at once is twenty-eight lines, which in a chat window that
     * holds ten is a list whose top has already scrolled away by the time it
     * has finished printing. So the bare command prints the sections and the
     * handful of things people actually want, and a topic prints one section
     * in full. The whole thing is also in the panel, where it can be read
     * without a scrollback, and in COMMANDS.md.
     */
    private static int help(FabricClientCommandSource source, String topic) {
        if (topic != null) {
            Manual.Section section = Manual.section(topic);
            if (section == null) {
                say(source, "no section called " + topic + " — try "
                        + String.join(", ", Manual.topics()));
                return 0;
            }
            say(source, "§b" + section.title());
            for (String line : Manual.lines(section)) say(source, "  " + line);
            return 1;
        }

        say(source, "§bUnderstudy — /understudy help <topic> for all of one kind");
        for (Manual.Section section : Manual.sections()) {
            say(source, "  §b" + section.id() + " §7— " + section.title().toLowerCase(
                    java.util.Locale.ROOT) + " (" + section.entries().size() + ")");
        }
        say(source, "§bthe ones people want first");
        say(source, "  /build §7— pick a design, then drag out where it goes");
        say(source, "  /get <item> [n] §7— go and get it, however that has to happen");
        say(source, "  /understudy auto §7— decide for itself what to do next");
        say(source, "  /panel §7— all of this in a browser, including this list");
        for (String note : Manual.NOTES) say(source, "§7" + note);
        return 1;
    }

    /**
     * What the mod thinks it has learned about you.
     *
     * Worth having as a command rather than hiding: a thing that adapts to you
     * silently is impossible to trust or correct.
     */
    private static int profile(FabricClientCommandSource source) {
        PlayerProfile p = UnderstudyClient.profile();
        if (p == null) {
            say(source, "no profile yet");
            return 0;
        }
        say(source, String.format("confidence %.0f%%", p.confidence() * 100));
        String block = p.favouriteBuildingBlock();
        say(source, "builds with: " + (block == null ? "not sure yet" : block));
        Integer depth = p.preferredMiningDepth();
        say(source, "mines around y=" + (depth == null ? "not sure yet" : depth));
        say(source, String.format("tunnels %.0f%%, bridges %.0f%%, swims %.0f%%, sprints %.0f%%",
                p.digTolerance() * 100, p.bridgeTolerance() * 100,
                p.swimTolerance() * 100, p.haste() * 100));
        return 1;
    }

    /**
     * Answer through chat and the overlay both.
     *
     * A reply that only goes to chat is invisible on a client whose chat is
     * switched off — which is precisely the situation several of these
     * commands exist to diagnose.
     */
    /**
     * Run a command body, turning any exception into something readable.
     *
     * Brigadier reports a thrown exception as a generic red "an unexpected
     * error occurred", which says nothing about which part failed. Naming the
     * command and the exception is the difference between a bug report and a
     * shrug.
     */
    private static int guarded(FabricClientCommandSource source, String name,
                               java.util.function.Supplier<Integer> body) {
        try {
            return body.get();
        } catch (Throwable error) {
            UnderstudyClient.LOG.error("/{} failed", name, error);
            Hud.warn("/" + name + " failed: " + error);
            source.sendFeedback(Component.literal("§8[§bunderstudy§8] §c/" + name + " failed: " + error));
            return 0;
        }
    }

    private static void say(FabricClientCommandSource source, String message) {
        UnderstudyClient.LOG.info("[cmd] {}", message);
        Hud.say(message);
        source.sendFeedback(Component.literal("§8[§bunderstudy§8] §r" + message));
    }
}
