package dev.understudy.client;

import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import dev.understudy.core.adapt.PlayerProfile;
import dev.understudy.core.build.Blueprint;
import dev.understudy.core.build.Schematic;
import dev.understudy.core.build.Catalog;
import dev.understudy.core.build.Designs;
import dev.understudy.core.build.Materials;
import dev.understudy.core.craft.Catalogue;
import dev.understudy.core.craft.Planner;
import dev.understudy.mc.Autopilot;
import dev.understudy.mc.Carried;
import dev.understudy.mc.Senses;
import dev.understudy.mc.Fight;
import dev.understudy.mc.GatherTask;
import dev.understudy.mc.HuntTask;
import dev.understudy.mc.BuildTask;
import dev.understudy.mc.ChatFix;
import dev.understudy.mc.Hud;
import dev.understudy.mc.Imports;
import dev.understudy.mc.SelfTest;
import dev.understudy.mc.SortTask;
import dev.understudy.mc.TravelTask;
import net.minecraft.client.Minecraft;
import net.minecraft.world.entity.monster.Monster;
import net.minecraft.world.entity.Entity;
import net.minecraft.client.player.LocalPlayer;
import dev.understudy.core.sort.Category;
import dev.understudy.core.mind.Agenda;

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
                                String typed = builder.getRemaining().toLowerCase();
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

            dispatcher.register(literal("sort")
                    .executes(context -> sort(context.getSource(), true))
                    .then(literal("all").executes(context -> sort(context.getSource(), false)))
                    .then(literal("stop").executes(context -> stop(context.getSource()))));

            dispatcher.register(literal("understudy")
                    .then(literal("stop").executes(context -> stop(context.getSource())))
                    .then(literal("pause").executes(context -> pause(context.getSource())))
                    .then(literal("resume").executes(context -> resume(context.getSource())))
                    .then(literal("status").executes(context -> status(context.getSource())))
                    .then(literal("profile").executes(context -> profile(context.getSource())))
                    .then(literal("help").executes(context -> help(context.getSource())))
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
                    .executes(context -> help(context.getSource())));
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

        Catalog.Entry entry = Catalog.byId(what.toLowerCase());
        if (entry == null && what.equalsIgnoreCase("shelter")) entry = Catalog.byId("hut");
        if (entry == null && what.equalsIgnoreCase("chests")) entry = Catalog.byId("storage");
        if (entry == null) {
            say(source, "I can build: " + String.join(", ", Catalog.ids()));
            return 0;
        }
        Materials.Wood wood = Materials.woodNamed(profile.favouriteWood());
        Materials.Stone stone = Materials.stoneNamed("stone brick");
        // What you actually build with wins over the default, which is the
        // whole point of watching: a base of deepslate should not get an oak
        // house dropped in the middle of it. Only the flat surfaces move — the
        // shaped pieces have to stay in a family that has stairs and slabs.
        Blueprint blueprint = Catalog.build(entry, size, wood, stone,
                Designs.paletteFrom(profile.buildingBlocks(6), Designs.paletteOf(wood, stone)));

        say(source, blueprint.name() + ": " + blueprint.blockCount() + " blocks");

        // The real plan against the real inventory, rather than a list of what
        // is missing. Knowing you are short of glass is less useful than being
        // told the sand is twenty seconds away and the furnace is not built yet.
        Map<String, Integer> carrying = Carried.contents(source.getPlayer());
        Planner.Plan plan = new Planner(Catalogue.solver())
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
        // Build in front of where you are standing, not on top of you.
        task.start(blueprint, source.getPlayer().blockPosition().offset(2, 0, 2));
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
        // Asking for new work is as clear a resume as there is.
        UnderstudyClient.resume();
        GatherTask gather = UnderstudyClient.gather();
        if (gather == null || source.getPlayer() == null) {
            say(source, "not in a world yet");
            return 0;
        }
        // Several things at once, joined with a plus. Not a convenience: the
        // planner costs them together, so the pickaxe, the crafting table and
        // the trip underground that iron and coal both need are paid for once
        // instead of twice. Asking for them one at a time is two trips down the
        // same tunnel.
        java.util.LinkedHashMap<String, Integer> wants = new java.util.LinkedHashMap<>();
        for (String each : rawItem.toLowerCase().replace("minecraft:", "").split("\\+")) {
            if (!each.isBlank()) wants.merge(each, count, Integer::sum);
        }
        if (wants.isEmpty()) {
            say(source, "nothing named");
            return 0;
        }
        String item = String.join(" and ", wants.keySet());

        Map<String, Integer> have = Carried.contents(source.getPlayer());
        Planner.Plan plan = new Planner(Catalogue.solver()).plan(wants, have);

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
            Planner.Plan withLight = new Planner(Catalogue.solver()).plan(lit, have);
            if (withLight.possible()) plan = withLight;
        }

        if (!plan.possible()) {
            say(source, "no way to get " + String.join(", ", plan.shortfall().keySet())
                    + " — /get with no name lists what it can");
            return 0;
        }
        if (plan.actions().isEmpty()) {
            say(source, "you already have " + count + " " + item);
            return 1;
        }

        say(source, String.format("%d %s: %s", count, item,
                plan.seconds() < 90
                        ? Math.round(plan.seconds()) + " seconds"
                        : Math.round(plan.seconds() / 60) + " minutes"));
        for (String line : plan.summary()) say(source, "  " + line);
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
            say(source, "chat settings were already fine:");
            for (String line : ChatFix.describe(client)) say(source, "  " + line);
            say(source, "so if you cannot see other players, it is the server, not your client");
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
                        + " — " + option.describe + ", " + option.blocksPerSecond() + " blocks/s");
            }
            say(source, "/understudy speed <steady|brisk|flat_out>");
            return 1;
        }
        for (BuildTask.Speed option : BuildTask.Speed.values()) {
            if (option.name().equalsIgnoreCase(how.replace(' ', '_'))) {
                BuildTask.speed(option);
                say(source, "building " + option.describe + " — "
                        + option.blocksPerSecond() + " blocks a second");
                return 1;
            }
        }
        say(source, "no such speed — steady, brisk or flat_out");
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

    private static int help(FabricClientCommandSource source) {
        say(source, "/travel <x> <y> <z> — walk there");
        say(source, "/build house|hut|tower|storage|manor [size] — build it");
        say(source, "/plan house [size] — what it would take, without building");
        say(source, "/get <item> [n] — go and get it, however that has to happen");
        say(source, "/get iron_ingot+coal 8 — several at once, planned as one trip");
        say(source, "/sort — put your things in the right chests (/sort all includes your kit)");
        say(source, "/understudy profile — what I have learned about how you play");
        say(source, "/understudy test — check what is working and what is not");
        say(source, "/understudy chatfix — repair chat settings that hide messages");
        say(source, "/understudy hud — toggle the on-screen overlay");
        say(source, "/understudy speed — how fast to build (steady, brisk, flat out)");
        say(source, "/understudy auto [item] [n] — get on with it; /understudy auto off");
        say(source, "/understudy why — what it thinks is going on and what it would do");
        say(source, "/understudy atlas — everywhere it has seen anything, kept between sessions");
        say(source, "/understudy timing — where the time actually goes");
        say(source, "/build imports — where to put models and what it makes of them");
        say(source, "/understudy stop — stop everything, at once (or just press a movement key)");
        say(source, "/understudy pause — hold it there; /understudy resume carries on");
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
