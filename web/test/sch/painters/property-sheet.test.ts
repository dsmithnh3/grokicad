/*
    Copyright (c) 2023 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import { assert } from "@esm-bundle/chai";

import { Matrix3, Vec2 } from "../../../src/base/math";
import { NullRenderer } from "../../../src/graphics/null-renderer";
import { SchematicSheet } from "../../../src/kicad/schematic";
import witch_hazel from "../../../src/kicanvas/themes/witch-hazel";
import { LayerNames, LayerSet } from "../../../src/viewers/schematic/layers";
import { SchematicPainter } from "../../../src/viewers/schematic/painter";

suite("sch.painters.property.sheet_fields", function () {
    test("sheet properties ignore stale symbol transform", function () {
        const sheet_expr = `(sheet
            (at 0 0 0)
            (size 100 50)
            (stroke (width 0.1524) (type default) (color 0 0 0 0))
            (fill (type none))
            (fields_autoplaced yes)
            (uuid 1234)
            (property "Sheet name" "BatteryBalance" (id 0) (at 10 10 0)
              (effects (font (size 1.27 1.27))))
            (property "Sheet file" "BatteryBalance.kicad_sch" (id 1) (at 10 5 0)
              (effects (font (size 1.27 1.27))))
        )`;

        const sheet = new SchematicSheet(sheet_expr, {
            resolve_text_var: () => undefined,
        } as any);
        const property = sheet.properties.get("Sheet name")!;

        const gfx = new NullRenderer();
        const layers = new LayerSet(witch_hazel.schematic);
        const painter = new SchematicPainter(
            gfx,
            layers,
            witch_hazel.schematic,
        );
        const property_painter = painter.painters.get(
            property.constructor,
        )! as any;
        property_painter.view_painter ??= painter;

        // Simulate a leaked symbol transform from a previously-painted symbol.
        painter.current_symbol_transform = {
            matrix: new Matrix3([0, -1, 0, -1, 0, 0, 0, 0, 1]),
            position: new Vec2(0, 0),
            rotations: 1,
            mirror_x: false,
            mirror_y: false,
        };

        const layer = layers.by_name(LayerNames.symbol_field)!;

        gfx.start_layer(layer.name);
        gfx.start_bbox();
        painter.paint_item(layer, property);
        const bbox = gfx.end_bbox(property);
        gfx.end_layer();

        // Rotation staying at 0° keeps width greater than height.
        assert.isAbove(bbox.w, bbox.h);
    });
});
