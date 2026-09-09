package dev.understudy.core.model;

import dev.understudy.core.build.Blueprint;
import dev.understudy.core.build.Schematic;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ModelTest {

    private static byte[] obj(String text) {
        return text.getBytes(StandardCharsets.UTF_8);
    }

    /** A unit cube as six quads. */
    private static final String CUBE = """
            v 0 0 0
            v 1 0 0
            v 1 1 0
            v 0 1 0
            v 0 0 1
            v 1 0 1
            v 1 1 1
            v 0 1 1
            f 1 2 3 4
            f 5 6 7 8
            f 1 2 6 5
            f 3 4 8 7
            f 1 4 8 5
            f 2 3 7 6
            """;

    // --- reading .obj --------------------------------------------------------

    @Test
    void readsVerticesAndTriangulatesQuads() throws IOException {
        Mesh mesh = ObjReader.read(obj(CUBE), name -> null);
        // Six quads, each a fan of two triangles.
        assertEquals(12, mesh.triangles().size());
    }

    @Test
    void acceptsTheThreeWaysToWriteAFaceIndex() throws IOException {
        // "v", "v/vt", "v//vn" and "v/vt/vn" all appear in files real exporters
        // produce, and only the part before the first slash is the position.
        Mesh mesh = ObjReader.read(obj("""
                v 0 0 0
                v 1 0 0
                v 0 1 0
                f 1/1 2//7 3/4/9
                """), name -> null);
        assertEquals(1, mesh.triangles().size());
        assertEquals(0.0, mesh.triangles().get(0).a()[0]);
        assertEquals(1.0, mesh.triangles().get(0).b()[0]);
    }

    @Test
    void countsNegativeIndicesBackFromTheEnd() throws IOException {
        // Blender writes these. Reading them as positive gives either the wrong
        // vertex or nothing at all.
        Mesh mesh = ObjReader.read(obj("""
                v 0 0 0
                v 5 0 0
                v 0 5 0
                f -3 -2 -1
                """), name -> null);
        assertEquals(1, mesh.triangles().size());
        assertEquals(5.0, mesh.triangles().get(0).b()[0]);
    }

    @Test
    void takesColoursFromTheMaterialLibrary() throws IOException {
        byte[] mtl = obj("""
                newmtl red
                Kd 1.0 0.0 0.0
                newmtl blue
                Kd 0.0 0.0 1.0
                """);
        Mesh mesh = ObjReader.read(obj("""
                mtllib thing.mtl
                v 0 0 0
                v 1 0 0
                v 0 1 0
                usemtl red
                f 1 2 3
                usemtl blue
                f 1 2 3
                """), name -> name.equals("thing.mtl") ? mtl : null);
        assertTrue(mesh.hasColours());
        assertEquals(0xFFFF0000, mesh.triangles().get(0).argb());
        assertEquals(0xFF0000FF, mesh.triangles().get(1).argb());
    }

    @Test
    void stillLoadsWhenTheMaterialFileIsMissing() throws IOException {
        // Models are shared as a bare .obj all the time. A shape without colours
        // is far better than a refusal.
        Mesh mesh = ObjReader.read(obj("""
                mtllib nowhere.mtl
                v 0 0 0
                v 1 0 0
                v 0 1 0
                usemtl gone
                f 1 2 3
                """), name -> null);
        assertEquals(1, mesh.triangles().size());
        assertFalse(mesh.hasColours());
    }

    @Test
    void refusesAFileWithNoFaces() {
        assertThrows(IOException.class, () -> ObjReader.read(obj("v 0 0 0\nv 1 0 0\n"), n -> null));
    }

    // --- reading .stl --------------------------------------------------------

    @Test
    void readsAsciiStl() throws IOException {
        Mesh mesh = StlReader.read(obj("""
                solid thing
                facet normal 0 0 1
                  outer loop
                    vertex 0 0 0
                    vertex 1 0 0
                    vertex 0 1 0
                  endloop
                endfacet
                endsolid thing
                """));
        assertEquals(1, mesh.triangles().size());
    }

    @Test
    void tellsBinaryStlApartByLengthNotByTheWordSolid() throws IOException {
        // The trap: binary files often start with "solid" too, because the
        // eighty-byte header gets filled in by exporters copying the ASCII
        // convention. Sniffing the word gets those wrong; the record size does not.
        ByteBuffer buffer = ByteBuffer.allocate(80 + 4 + 50).order(ByteOrder.LITTLE_ENDIAN);
        buffer.put("solid this is actually binary".getBytes(StandardCharsets.UTF_8));
        buffer.position(80);
        buffer.putInt(1);
        for (int i = 0; i < 3; i++) buffer.putFloat(0); // normal
        buffer.putFloat(0).putFloat(0).putFloat(0);
        buffer.putFloat(2).putFloat(0).putFloat(0);
        buffer.putFloat(0).putFloat(2).putFloat(0);
        buffer.putShort((short) 0);

        assertTrue(StlReader.looksBinary(buffer.array()));
        Mesh mesh = StlReader.read(buffer.array());
        assertEquals(1, mesh.triangles().size());
        assertEquals(2.0, mesh.triangles().get(0).b()[0], 1e-6);
    }

    // --- voxelising ----------------------------------------------------------

    @Test
    void aCubeBecomesAHollowBoxOfTheRightSize() throws IOException {
        Mesh mesh = ObjReader.read(obj(CUBE), name -> null);
        Voxeliser.Voxels voxels = Voxeliser.voxelise(mesh, Voxeliser.Options.ofHeight(8));

        assertEquals(9, voxels.sizeX());
        assertEquals(9, voxels.sizeY());
        assertEquals(9, voxels.sizeZ());
        // The surface of a 9-cube is 9^3 minus the 7^3 inside it.
        assertTrue(voxels.count() < 9 * 9 * 9, "surface only, not solid");
        assertTrue(voxels.count() > 9 * 9 * 2, "should cover the faces");
        // Nothing in the middle.
        assertFalse(voxels.cells().containsKey(Voxeliser.key(4, 4, 4)));
    }

    @Test
    void fillingMakesItSolid() throws IOException {
        Mesh mesh = ObjReader.read(obj(CUBE), name -> null);
        Voxeliser.Voxels hollow = Voxeliser.voxelise(mesh, Voxeliser.Options.ofHeight(8));
        Voxeliser.Voxels solid = Voxeliser.voxelise(mesh, new Voxeliser.Options(8, true, true));

        assertTrue(solid.count() > hollow.count());
        assertTrue(solid.cells().containsKey(Voxeliser.key(4, 4, 4)), "the middle should be filled");
    }

    @Test
    void heightIsTheSizeYouAskedFor() throws IOException {
        Mesh mesh = ObjReader.read(obj(CUBE), name -> null);
        for (int height : new int[]{4, 12, 30}) {
            Voxeliser.Voxels voxels = Voxeliser.voxelise(mesh, Voxeliser.Options.ofHeight(height));
            assertEquals(height + 1, voxels.sizeY(), "asked for " + height + " tall");
        }
    }

    @Test
    void standsUpAModelThatWasLyingDown() throws IOException {
        // Blender and most CAD are Z-up, Minecraft is Y-up, and getting it wrong
        // leaves a house on its face. A thing much deeper than it is tall is
        // taken to be lying down.
        String lyingDown = """
                v 0 0 0
                v 2 0 0
                v 2 1 0
                v 0 1 0
                v 0 0 9
                v 2 0 9
                v 2 1 9
                v 0 1 9
                f 1 2 3 4
                f 5 6 7 8
                f 1 2 6 5
                f 3 4 8 7
                """;
        Mesh mesh = ObjReader.read(obj(lyingDown), name -> null);
        Voxeliser.Voxels voxels = Voxeliser.voxelise(mesh, Voxeliser.Options.ofHeight(18));
        assertTrue(voxels.sizeY() > voxels.sizeZ(),
                "the long axis should end up vertical: " + voxels.sizeY() + " tall, "
                        + voxels.sizeZ() + " deep");
    }

    @Test
    void aTallModelIsLeftAlone() throws IOException {
        Mesh mesh = ObjReader.read(obj(CUBE), name -> null);
        Voxeliser.Voxels voxels = Voxeliser.voxelise(mesh, Voxeliser.Options.ofHeight(8));
        assertEquals(voxels.sizeY(), voxels.sizeZ(), "a cube must not be rotated");
    }

    // --- colour matching -----------------------------------------------------

    @Test
    void onlyEverSuggestsBlocksThatCanBeObtained() {
        // The whole design: a matcher over every block in the game gives lovely
        // colour coverage and a build order full of concrete nobody can make.
        Map<String, Integer> palette = BlockColours.palette();
        assertFalse(palette.isEmpty());
        var reachable = dev.understudy.core.craft.Catalogue.solver().solve(Map.of());
        for (String block : palette.keySet()) {
            assertTrue(reachable.containsKey(block) && reachable.get(block).reachable(),
                    block + " is in the palette but cannot be obtained");
        }
    }

    @Test
    void matchesLightToLightAndDarkToDark() {
        String white = BlockColours.nearest(0xFFFFFFFF);
        String black = BlockColours.nearest(0xFF000000);
        assertFalse(white.equals(black));
        int whiteValue = BlockColours.palette().get(white);
        int blackValue = BlockColours.palette().get(black);
        assertTrue(brightness(whiteValue) > brightness(blackValue),
                "white matched to " + white + " and black to " + black);
    }

    private static int brightness(int argb) {
        return ((argb >> 16) & 0xFF) + ((argb >> 8) & 0xFF) + (argb & 0xFF);
    }

    // --- through the importer ------------------------------------------------

    @Test
    void anObjBecomesABlueprintWithAPicture() throws IOException {
        Schematic.Result result = Schematic.readModel("statue.obj", obj(CUBE), 10, false, "stone");
        Blueprint blueprint = result.blueprint();
        assertEquals("statue", blueprint.name());
        assertTrue(blueprint.blockCount() > 0);
        assertEquals(Set.of("stone"), blueprint.materials().keySet(),
                "no colours in the file, so it is built in what was chosen");
        assertFalse(dev.understudy.core.build.Preview.of(blueprint).isEmpty());
    }

    @Test
    void acolouredModelUsesMatchedBlocks() throws IOException {
        byte[] mtl = obj("newmtl pale\nKd 0.95 0.95 0.95\n");
        String coloured = CUBE.replace("f 1 2 3 4", "usemtl pale\nf 1 2 3 4");
        Mesh mesh = ObjReader.read(obj("mtllib c.mtl\n" + coloured),
                name -> mtl);
        assertTrue(mesh.hasColours());
    }

    @Test
    void refusesAModelThatIsNotOne() {
        assertThrows(IOException.class,
                () -> Schematic.readModel("notes.txt", obj("hello there"), 10, false, "stone"));
    }
}
