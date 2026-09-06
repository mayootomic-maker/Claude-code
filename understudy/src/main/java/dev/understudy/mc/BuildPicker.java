package dev.understudy.mc;

import dev.understudy.core.build.Blueprint;
import dev.understudy.core.build.Catalog;
import dev.understudy.core.build.Schematic;
import dev.understudy.core.build.Materials;
import dev.understudy.core.build.Preview;
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

    private static final int PANEL = 0xC0101418;
    private static final int LINE = 0xFF39414B;
    private static final int SELECTED = 0xFF2E6DA4;
    private static final int TEXT = 0xFFE6E6E6;
    private static final int DIM = 0xFF9AA3AD;

    private final Map<String, Integer> inventory;
    /** Called with the chosen design, size and materials once the player commits. */
    private final Chosen onChoose;

    /** What the menu hands back: a finished blueprint, however it was arrived at. */
    public interface Chosen {
        void accept(Blueprint blueprint);
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
    private int woodIndex;
    private int stoneIndex = 1;
    private Blueprint blueprint;
    private Preview.Image image;
    private String costLine = "";
    private String modelNote;

    public BuildPicker(Map<String, Integer> inventory, Chosen onChoose) {
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

    @Override
    protected void init() {
        int listX = 16;
        int listY = 44;
        for (int i = 0; i < options.size(); i++) {
            int index = i;
            addRenderableWidget(Button.builder(Component.literal(shorten(options.get(i).label())),
                            button -> select(index))
                    .bounds(listX, listY + i * 24, 120, 20).build());
        }

        int controlsY = listY + options.size() * 24 + 16;
        addRenderableWidget(Button.builder(Component.literal("-"), button -> resize(-1))
                .bounds(listX, controlsY, 24, 20).build());
        addRenderableWidget(Button.builder(Component.literal("+"), button -> resize(1))
                .bounds(listX + 96, controlsY, 24, 20).build());

        // Materials cycle rather than opening a second menu: eight woods and
        // seven masonries is a list nobody wants to scroll, and the preview
        // shows the answer immediately anyway.
        addRenderableWidget(Button.builder(Component.literal("Wood \u203a"), button -> cycleWood(1))
                .bounds(listX, controlsY + 24, 120, 20).build());
        addRenderableWidget(Button.builder(Component.literal("Stone \u203a"), button -> cycleStone(1))
                .bounds(listX, controlsY + 48, 120, 20).build());
        addRenderableWidget(Button.builder(Component.literal("Hollow / solid"),
                        button -> toggleSolid())
                .bounds(listX, controlsY + 72, 120, 20).build());
        addRenderableWidget(Button.builder(Component.literal("Choose where"), button -> commit())
                .bounds(listX, controlsY + 100, 120, 20).build());
        addRenderableWidget(Button.builder(Component.literal("Cancel"), button -> onClose())
                .bounds(listX, controlsY + 124, 120, 20).build());

        refresh();
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
            size = Math.max(8, Math.min(120, size + by * 4));
        } else {
            return;
        }
        refresh();
    }

    private void toggleSolid() {
        solid = !solid;
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
        onChoose.accept(blueprint);
        onClose();
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
        image = Preview.of(blueprint);

        Planner.Plan plan = new Planner(Catalogue.solver())
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
        int panelX = 148;
        int panelY = 44;
        int panelW = width - panelX - 16;
        int panelH = height - panelY - 16;

        graphics.fill(panelX, panelY, panelX + panelW, panelY + panelH, PANEL);
        graphics.outline(panelX, panelY, panelW, panelH, LINE);

        String title = option.label();
        String summary = option instanceof Designed designed
                ? designed.entry().summary()
                : "imported from " + ((Imported) option).file().getFileName();
        String detail;
        if (option instanceof Designed) {
            detail = "size " + size + "  ·  " + wood().name() + "  ·  " + stone().name();
        } else if (option instanceof Imported imported && imported.model()) {
            detail = size + " tall  ·  " + (solid ? "solid" : "hollow") + "  ·  " + wood().name();
        } else {
            detail = ((Imported) option).note();
        }

        graphics.text(font, Component.literal(title), panelX + 10, panelY + 10, TEXT);
        graphics.text(font, Component.literal(summary), panelX + 10, panelY + 24, DIM);
        graphics.text(font, Component.literal(detail), panelX + 10, panelY + 38, DIM);
        if (modelNote != null && option instanceof Imported imported && imported.model()) {
            graphics.text(font, Component.literal(modelNote), panelX + 10, panelY + 52, DIM);
        }

        drawPreview(graphics, panelX + 10, panelY + 56, panelW - 20, panelH - 96);
        graphics.text(font, Component.literal(costLine), panelX + 10, panelY + panelH - 26, TEXT);

        graphics.text(font, Component.literal(String.valueOf(size)), 16 + 40,
                44 + options.size() * 24 + 22, TEXT);
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
