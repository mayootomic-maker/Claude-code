package dev.understudy.mc;

import dev.understudy.core.build.Blueprint;
import dev.understudy.core.build.Catalog;
import dev.understudy.core.build.Schematic;
import dev.understudy.core.build.Sized;
import dev.understudy.core.build.Materials;
import dev.understudy.core.build.Palette;
import dev.understudy.core.build.Preview;
import dev.understudy.core.adapt.Measured;
import dev.understudy.core.craft.Catalogue;
import dev.understudy.core.craft.Planner;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * The menu /build opens: everything the mod can build, with a picture of each.
 *
 * The pictures are drawn from the blueprint rather than fetched from anywhere.
 * A photograph off the internet shows someone else's house, in someone else's
 * materials, at a size this is not going to build; this shows the exact
 * structure that will be placed, in the palette it will use, and it redraws when
 * the size changes. It also needs no network and ships nothing copyrighted.
 *
 * The cost line under the preview is the real plan, run against what is actually
 * in your inventory — so it says "four minutes" when you have the wood and
 * "twenty" when you do not, rather than quoting an average nobody has.
 */
public final class BuildPicker extends Screen {

    /**
     * The palette, and why it is this one.
     *
     * A screen inside Minecraft that ignores Minecraft's own conventions reads
     * as a foreign object bolted on, however tidy it is on its own terms. So:
     * a dark translucent ground rather than a solid one, a single hairline
     * rather than rounded corners and shadows, one accent and no more, and type
     * that lines up in columns. What is not vanilla is the restraint — the game
     * itself would put a border on every one of these.
     */
    private static final int SHADE = 0xC0080B0E;
    private static final int PANEL = 0xE0141A20;
    private static final int RAISED = 0xFF1D262F;
    private static final int LINE = 0xFF39414B;
    private static final int ACCENT = 0xFF54B87A;
    private static final int ACCENT_DIM = 0x4054B87A;
    private static final int TEXT = 0xFFE6E6E6;
    private static final int DIM = 0xFF9AA3AD;
    private static final int FAINT = 0xFF6A737D;

    /** Row metrics for the list, which is drawn rather than made of widgets. */
    private static final int ROW = 13;
    private static final int RAIL = 150;

    private int scroll;

    private final Map<String, Integer> inventory;
    /** Called with the chosen design, size and materials once the player commits. */
    private final Chosen onChoose;

    /**
     * What the menu hands back.
     *
     * A {@link Sized} rather than a finished blueprint, so the plot you then
     * drag on the ground can still decide how big the thing is. The menu's own
     * size control stays — it is how you say what you want before you have a
     * plot in mind, and it is the only control an import has, since a schematic
     * is the size it was saved at.
     */
    public interface Chosen {
        void accept(Sized design);
    }

    /**
     * One row in the list: either something this mod knows how to design, or a
     * schematic somebody dropped in the folder.
     *
     * An import has no size and no materials — it is already made of what it is
     * made of — so those controls simply do not apply to it.
     */
    private sealed interface Option {
        String label();
    }

    private record Designed(Catalog.Entry entry) implements Option {
        @Override
        public String label() {
            return entry.name();
        }
    }

    private record Imported(Path file, Blueprint blueprint, String note, boolean model)
            implements Option {
        @Override
        public String label() {
            return blueprint == null ? file.getFileName().toString() : blueprint.name();
        }
    }

    private final List<Option> options = new ArrayList<>();
    private int selected;
    private int size;
    private boolean solid;
    private int turns;
    private boolean upsideDown;
    private int woodIndex;
    private int stoneIndex = 1;
    private Blueprint blueprint;
    private Preview.Image image;
    private String costLine = "";
    private String modelNote;

    /** What things cost here, so the preview quotes the same number the job will. */
    private final Measured measured;

    public BuildPicker(Map<String, Integer> inventory, Measured measured, Chosen onChoose) {
        this.measured = measured;
        super(Component.literal("Build"));
        this.inventory = inventory;
        this.onChoose = onChoose;
        this.size = Catalog.entries().get(0).defaultSize();
        for (Catalog.Entry entry : Catalog.entries()) options.add(new Designed(entry));
        // Imports are read when the menu opens, not held between openings, so a
        // file dropped in the folder while the game is running is simply there.
        for (Path file : Imports.list()) {
            // A model is not read here: it has no size until one is chosen, and
            // voxelising every model in the folder to draw a list would be a
            // slow way to open a menu. It is built when it is selected.
            if (Imports.isModel(file)) {
                options.add(new Imported(file, null, "3D model — pick a height", true));
                continue;
            }
            try {
                Schematic.Result result = Imports.load(file);
                options.add(new Imported(file, result.blueprint(),
                        String.join(" · ", result.notes()), false));
            } catch (Exception error) {
                // A file that will not read is still listed, with the reason, so
                // it is obvious which one is the problem rather than it silently
                // not appearing.
                options.add(new Imported(file, null, "could not read: " + error.getMessage(), false));
            }
        }
    }

    /**
     * Where everything sits, worked out from the window rather than pinned to it.
     *
     * The old layout was a column of buttons, one per design, at fixed pixel
     * offsets. Two things were wrong with that and the second is the one that
     * mattered: a button is a box with a border and a label, so twelve of them
     * is twelve boxes and no hierarchy — nothing says which are this mod's
     * designs and which are files you dropped in a folder. And a fixed column
     * runs off the bottom of the screen the moment you have more than a handful
     * of imports, with no way to reach the rest.
     *
     * So the list is drawn rather than built: rows of text on a highlight,
     * under headings, scrolled by the keyboard and clickable. Only the things
     * that genuinely are buttons are buttons, and they are on one line at the
     * bottom where the eye finishes rather than scattered down the side.
     */
    @Override
    protected void init() {
        int bottom = height - 28;
        int x = 16;

        addRenderableWidget(Button.builder(Component.literal("\u2212"), b -> resize(-1))
                .bounds(x, bottom, 20, 20).build());
        addRenderableWidget(Button.builder(Component.literal("+"), b -> resize(1))
                .bounds(x + 52, bottom, 20, 20).build());
        x += 80;

        addRenderableWidget(Button.builder(Component.literal("Wood \u203a"), b -> cycleWood(1))
                .bounds(x, bottom, 74, 20).build());
        addRenderableWidget(Button.builder(Component.literal("Stone \u203a"), b -> cycleStone(1))
                .bounds(x + 78, bottom, 74, 20).build());
        x += 160;

        addRenderableWidget(Button.builder(Component.literal("Turn \u21bb"), b -> turn())
                .bounds(x, bottom, 52, 20).build());
        addRenderableWidget(Button.builder(Component.literal("Flip \u21c5"), b -> flip())
                .bounds(x + 56, bottom, 52, 20).build());
        addRenderableWidget(Button.builder(Component.literal("Solid \u25a0"), b -> toggleSolid())
                .bounds(x + 112, bottom, 56, 20).build());

        // The list has no scrollbar you can drag and no row you can click yet,
        // so it has these.
        addRenderableWidget(Button.builder(Component.literal("\u25b2"), b -> move(-1))
                .bounds(RAIL - 26, 54, 18, 18).build());
        addRenderableWidget(Button.builder(Component.literal("\u25bc"), b -> move(1))
                .bounds(RAIL - 26, height - 52, 18, 18).build());

        addRenderableWidget(Button.builder(Component.literal("Cancel"), b -> onClose())
                .bounds(width - 176, bottom, 74, 20).build());
        addRenderableWidget(Button.builder(Component.literal("Place \u2192"), b -> commit())
                .bounds(width - 96, bottom, 80, 20).build());

        refresh();
    }

    /** How many rows of the list the window has room for. */
    private int rowsThatFit() {
        return Math.max(3, (height - 28 - 56 - 12) / ROW);
    }

    /** One drawn line: either a heading, or an option and which one. */
    private record Row(String text, int option) {
        boolean heading() {
            return option < 0;
        }
    }

    /**
     * The list as it reads, headings included.
     *
     * Built each time rather than kept: it is a dozen entries, and rebuilding it
     * is cheaper than keeping two things that have to agree with each other.
     */
    private List<Row> rows() {
        List<Row> out = new ArrayList<>();
        boolean openedImports = false;
        for (int i = 0; i < options.size(); i++) {
            Option option = options.get(i);
            if (out.isEmpty() && option instanceof Designed) out.add(new Row("DESIGNS", -1));
            if (!(option instanceof Designed) && !openedImports) {
                openedImports = true;
                out.add(new Row("IMPORTED", -1));
            }
            out.add(new Row(option.label(), i));
        }
        return out;
    }

    /**
     * Move the selection, skipping the headings.
     *
     * Arrow keys rather than only the mouse because this is a list and a list
     * is the one thing a keyboard is unambiguously better at.
     */
    private void move(int by) {
        selected = Math.max(0, Math.min(options.size() - 1, selected + by));
        int shown = rowsThatFit();
        if (selected < scroll) scroll = selected;
        if (selected >= scroll + shown) scroll = selected - shown + 1;
        select(selected);
    }

    /**
     * Arrow keys, because a list is the one thing a keyboard is better at.
     *
     * Input is an object in this version rather than three loose ints, which is
     * the shape I guessed at once and got wrong. KeyEvent and MouseButtonEvent
     * both carry input() — the key or the button — from the interface they
     * share, and the mouse one carries where it happened.
     */
    @Override
    public boolean keyPressed(net.minecraft.client.input.KeyEvent event) {
        switch (event.input()) {
            case org.lwjgl.glfw.GLFW.GLFW_KEY_UP -> move(-1);
            case org.lwjgl.glfw.GLFW.GLFW_KEY_DOWN -> move(1);
            case org.lwjgl.glfw.GLFW.GLFW_KEY_LEFT -> resize(-1);
            case org.lwjgl.glfw.GLFW.GLFW_KEY_RIGHT -> resize(1);
            case org.lwjgl.glfw.GLFW.GLFW_KEY_R -> turn();
            case org.lwjgl.glfw.GLFW.GLFW_KEY_ENTER, org.lwjgl.glfw.GLFW.GLFW_KEY_KP_ENTER ->
                    commit();
            default -> {
                return super.keyPressed(event);
            }
        }
        return true;
    }

    /**
     * Clicking a row picks it.
     *
     * Checked before the widgets get a look in, but only inside the rail, so
     * every button still behaves. A click on a heading or on empty space below
     * the last row does nothing rather than picking whatever was nearest, which
     * is the thing that makes a list feel unreliable.
     */
    @Override
    public boolean mouseClicked(net.minecraft.client.input.MouseButtonEvent event,
                                boolean doubled) {
        int top = 56;
        if (event.x() >= 14 && event.x() < RAIL - 8 && event.y() >= top) {
            int at = rowAt((int) ((event.y() - top) / ROW));
            if (at >= 0) {
                selected = at;
                select(at);
                return true;
            }
        }
        return super.mouseClicked(event, doubled);
    }

    /** Which option a drawn row belongs to, or -1 for a heading or empty space. */
    private int rowAt(int row) {
        List<Row> all = rows();
        int at = row + scroll;
        return at >= 0 && at < all.size() ? all.get(at).option() : -1;
    }

    private void select(int index) {
        selected = index;
        if (options.get(index) instanceof Designed designed) {
            size = designed.entry().defaultSize();
        } else if (options.get(index) instanceof Imported imported && imported.model()) {
            size = 20;
        }
        refresh();
    }

    private void resize(int by) {
        Option option = options.get(selected);
        if (option instanceof Designed designed) {
            size = Math.max(designed.entry().minSize(),
                    Math.min(designed.entry().maxSize(), size + by));
        } else if (option instanceof Imported imported && imported.model()) {
            // A model's size is how tall it comes out. Under about eight blocks
            // nothing recognisable survives, and past a hundred it is a project
            // rather than a build.
            size = Math.max(MODEL_MIN, Math.min(MODEL_MAX, size + by * 4));
        } else {
            return;
        }
        refresh();
    }

    /** Under this nothing recognisable survives voxelising; over it, it is a project. */
    private static final int MODEL_MIN = 8;
    private static final int MODEL_MAX = 120;

    private void toggleSolid() {
        solid = !solid;
        refresh();
    }

    private void turn() {
        turns = (turns + 1) % 4;
        refresh();
    }

    private void flip() {
        upsideDown = !upsideDown;
        refresh();
    }

    private static String shorten(String label) {
        return label.length() <= 17 ? label : label.substring(0, 16) + "\u2026";
    }

    private void cycleWood(int by) {
        woodIndex += by;
        refresh();
    }

    private void cycleStone(int by) {
        stoneIndex += by;
        refresh();
    }

    private Materials.Wood wood() {
        return Materials.wood(woodIndex);
    }

    private Materials.Stone stone() {
        return Materials.stone(stoneIndex);
    }

    private void commit() {
        if (blueprint == null) return;
        onChoose.accept(sized());
        onClose();
    }

    /**
     * The choice, plus how to make it again at another size.
     *
     * The settings are read once, here, and captured — the menu is about to
     * close, and a maker that read its fields later would be reading fields
     * belonging to a screen nobody is looking at.
     */
    private Sized sized() {
        Option option = options.get(selected);
        int turnsNow = turns;
        boolean flipped = upsideDown;
        if (option instanceof Designed designed) {
            Catalog.Entry entry = designed.entry();
            Materials.Wood w = wood();
            Materials.Stone st = stone();
            return Sized.of(blueprint,
                    n -> Catalog.build(entry, n, w, st).turned(turnsNow, flipped),
                    entry.minSize(), entry.maxSize());
        }
        if (option instanceof Imported imported && imported.model()) {
            boolean solidNow = solid;
            String planks = wood().planks();
            return Sized.of(blueprint, n -> {
                try {
                    return Imports.loadModel(imported.file(), n, solidNow, planks)
                            .blueprint().turned(turnsNow, flipped);
                } catch (Exception error) {
                    // A model that read once and will not read again at another
                    // size is not a reason to lose the one that did read.
                    return blueprint;
                }
            }, MODEL_MIN, MODEL_MAX);
        }
        // A schematic is the size somebody saved it at. Resampling a structure
        // is not scaling it, it is damaging it, so this one genuinely cannot be
        // resized and says so rather than offering a control that would lie.
        return Sized.fixed(blueprint);
    }

    /**
     * Rebuild the blueprint, its picture and its cost.
     *
     * Done on change rather than per frame: planning a house is a graph search,
     * and running one sixty times a second to draw a line of text would be a
     * strange way to spend a frame budget.
     */
    private void refresh() {
        Option option = options.get(selected);
        if (option instanceof Designed designed) {
            blueprint = Catalog.build(designed.entry(), size, wood(), stone());
        } else if (option instanceof Imported imported && imported.model()) {
            // Voxelising is quick but not free, so it happens on a change of
            // size or material rather than per frame.
            try {
                Schematic.Result result = Imports.loadModel(imported.file(), size, solid,
                        wood().planks());
                blueprint = result.blueprint();
                modelNote = String.join(" · ", result.notes());
            } catch (Exception error) {
                blueprint = null;
                modelNote = "could not read: " + error.getMessage();
            }
        } else if (option instanceof Imported imported) {
            blueprint = imported.blueprint();
        }
        if (blueprint == null) {
            image = null;
            costLine = "§c" + (modelNote != null ? modelNote : ((Imported) option).note());
            return;
        }
        // Applied after whatever produced the blueprint, so it corrects a
        // built-in design turned to suit a plot just as well as it corrects a
        // model that came out of Blender standing on its head.
        blueprint = blueprint.turned(turns, upsideDown);
        image = Preview.of(blueprint);

        Planner.Plan plan = new Planner(Catalogue.solver(), measured)
                .plan(blueprint.essentialMaterials(), inventory);
        if (!plan.possible()) {
            costLine = "§cmissing: " + String.join(", ", plan.shortfall().keySet());
        } else if (plan.actions().isEmpty()) {
            costLine = "§aeverything needed is already in your inventory";
        } else {
            costLine = String.format("%d blocks · about %s to gather and build",
                    blueprint.blockCount(), minutes(plan.seconds()));
        }
    }

    /** Only says anything when it has been turned, so the usual case stays quiet. */
    private String turnNote() {
        if (turns == 0 && !upsideDown) return "";
        return "  \u00b7  " + (turns == 0 ? "" : (turns * 90) + "\u00b0 ")
                + (upsideDown ? "flipped" : "").trim();
    }

    private static String minutes(double seconds) {
        if (seconds < 90) return Math.round(seconds) + " seconds";
        return Math.round(seconds / 60) + " minutes";
    }

    /**
     * Not render(): Minecraft 26 screens describe what they want drawn and the
     * game draws it later, so there is no render method to override at all any
     * more. Everything below still just says "fill this rectangle" — that part
     * of the API survived the rework unchanged.
     */
    @Override
    public void extractRenderState(GuiGraphicsExtractor graphics, int mouseX, int mouseY,
                                   float partialTick) {
        super.extractRenderState(graphics, mouseX, mouseY, partialTick);
        Option option = options.get(selected);

        graphics.fill(0, 0, width, height, SHADE);
        graphics.text(font, Component.literal("Build"), 16, 20, TEXT);
        graphics.text(font, Component.literal("\u2191\u2193 choose  \u2190\u2192 size  "
                + "R turn  \u23ce place"), 16, 34, FAINT);
        graphics.fill(16, 46, width - 16, 47, LINE);

        drawList(graphics);
        drawPanel(graphics, option);

        // The size, between the two buttons that change it, because a number
        // you can alter and cannot read is a strange thing to offer.
        // text rather than centeredText: this file only uses primitives whose
        // shape is already proven elsewhere in the mod, and centring by hand
        // costs one call to the font.
        String label = sizeLabel();
        graphics.text(font, Component.literal(label),
                16 + 36 - (font == null ? 0 : font.width(label) / 2), height - 22, TEXT);
    }

    /** What the size control is currently set to, in the units that design uses. */
    private String sizeLabel() {
        Option option = options.get(selected);
        if (option instanceof Designed) return String.valueOf(size);
        if (option instanceof Imported imported && imported.model()) return size + "h";
        // A schematic is the size it was saved at and the control does nothing.
        return "\u2014";
    }

    /**
     * The rail: headings, rows, and a mark on the one that is chosen.
     *
     * The selected row is a filled bar with a bright edge rather than a
     * different colour of text. Colour alone is a weak signal at this size and
     * on a translucent ground it is weaker still; a shape you can see out of the
     * corner of your eye is what a selection needs to be.
     */
    private void drawList(GuiGraphicsExtractor graphics) {
        List<Row> all = rows();
        int top = 56;
        int shown = rowsThatFit();

        for (int i = 0; i < shown && i + scroll < all.size(); i++) {
            Row row = all.get(i + scroll);
            int y = top + i * ROW;
            if (row.heading()) {
                graphics.text(font, Component.literal(row.text()), 16, y + 2, FAINT);
                continue;
            }
            boolean chosen = row.option() == selected;
            if (chosen) {
                graphics.fill(14, y - 1, RAIL - 8, y + ROW - 2, ACCENT_DIM);
                graphics.fill(14, y - 1, 16, y + ROW - 2, ACCENT);
            }
            graphics.text(font, Component.literal(shorten(row.text())), 22, y + 1,
                    chosen ? TEXT : DIM);
        }

        // Only says anything when there is something out of sight, which is the
        // only time a scrollbar tells you anything you did not know.
        if (all.size() > shown) {
            int barTop = top + (int) ((double) scroll / all.size() * (shown * ROW));
            int barHeight = Math.max(8, (int) ((double) shown / all.size() * (shown * ROW)));
            graphics.fill(RAIL - 6, top, RAIL - 5, top + shown * ROW, LINE);
            graphics.fill(RAIL - 7, barTop, RAIL - 4, barTop + barHeight, DIM);
        }
    }

    /** The panel: what this one is, what it will cost, and a picture of it. */
    private void drawPanel(GuiGraphicsExtractor graphics, Option option) {
        int x = RAIL + 8;
        int y = 56;
        int w = width - x - 16;
        int h = height - y - 36;

        graphics.fill(x, y, x + w, y + h, PANEL);
        graphics.outline(x, y, w, h, LINE);

        graphics.text(font, Component.literal(option.label()), x + 12, y + 12, TEXT);
        String summary = option instanceof Designed designed
                ? designed.entry().summary()
                : "imported from " + ((Imported) option).file().getFileName();
        graphics.text(font, Component.literal(clip(summary, w - 24)), x + 12, y + 26, DIM);

        // The numbers on one line, in columns, because that is what makes three
        // facts read as three facts rather than as a sentence.
        String stats = blueprint == null ? "\u2014"
                : blueprint.sizeX() + " \u00d7 " + blueprint.sizeZ() + " wide  \u00b7  "
                        + blueprint.sizeY() + " tall  \u00b7  " + blueprint.blockCount()
                        + " blocks";
        graphics.text(font, Component.literal(stats), x + 12, y + 42, DIM);

        swatches(graphics, x + 12, y + 58);

        int pictureTop = y + 74;
        int pictureHeight = h - 74 - 30;
        drawPreview(graphics, x + 12, pictureTop, w - 24, pictureHeight);

        graphics.fill(x + 12, y + h - 26, x + w - 12, y + h - 25, LINE);
        graphics.text(font, Component.literal(clip(costLine, w - 24)), x + 12, y + h - 18,
                costLine.startsWith("\u00a7c") ? TEXT : DIM);
    }

    /**
     * The materials, as the colours they are.
     *
     * "Wood: spruce" is a fact you have to picture. Two chips of the actual
     * block colour beside the name is the same fact already pictured, and it is
     * the colour the preview is drawn in, so the two agree by construction.
     */
    private void swatches(GuiGraphicsExtractor graphics, int x, int y) {
        int at = x;
        for (String block : List.of(wood().planks(), stone().block())) {
            graphics.fill(at, y, at + 8, y + 8, 0xFF000000 | Palette.colourOf(block));
            graphics.outline(at - 1, y - 1, 10, 10, LINE);
            at += 12;
        }
        graphics.text(font, Component.literal(wood().name() + " \u00b7 " + stone().name()),
                at + 2, y, DIM);
        if (turns != 0 || upsideDown) {
            graphics.text(font, Component.literal(turnNote().trim()), at + 2, y + 11, FAINT);
        }
    }

    /** Cut a line to the width it has, in characters the font actually measures. */
    private String clip(String text, int room) {
        if (font == null || font.width(text) <= room) return text;
        return font.plainSubstrByWidth(text, room - font.width("\u2026")) + "\u2026";
    }

    /**
     * Draw the preview, scaled to fit and centred.
     *
     * Each run is one fill call. A house is a few hundred of them, which is
     * nothing — and it is the only drawing primitive whose shape did not change
     * in this version of the game.
     */
    private void drawPreview(GuiGraphicsExtractor graphics, int x, int y, int boxW, int boxH) {
        if (image == null || image.isEmpty()) return;
        int scale = Math.max(1, Math.min(boxW / image.width(), boxH / image.height()));
        int drawnW = image.width() * scale;
        int drawnH = image.height() * scale;
        int offsetX = x + (boxW - drawnW) / 2;
        int offsetY = y + (boxH - drawnH) / 2;

        for (Preview.Run run : image.runs()) {
            int left = offsetX + run.x() * scale;
            int top = offsetY + run.y() * scale;
            graphics.fill(left, top, left + run.length() * scale, top + scale, run.argb());
        }
    }

    @Override
    public boolean isPauseScreen() {
        return false;
    }
}
