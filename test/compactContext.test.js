import { describe, expect, it } from "vitest";
import {
  buildCompactRequestMessages,
  COMPACT_CONTEXT_TARGET_TOKENS,
} from "../src/llm/compactContext.js";

describe("compact Groq request context", () => {
  it("preserves core settings and intent while dropping custom defaults and previews", () => {
    const fullPayload = {
      version: 1,
      projectSummary: {
        fileName: "project.3mf",
        printer: {
          name: "Bambu A1",
          nozzle_diameter_mm: 0.4,
          bed_type: "Textured PEI",
          private_unused_metadata: "not needed",
        },
        filaments: [{ name: "PLA", material_family: "PLA", color: "red" }],
        base_profile: "0.20 Standard",
        plates: [
          {
            index: 0,
            name: "Plate 1",
            objects: [
              {
                name: "Bracket",
                geometry: {
                  bounding_box_mm: [20, 30, 40],
                  max_dimension_mm: 40,
                  private_mesh_data: "remove",
                },
              },
            ],
          },
        ],
      },
      currentSettings: {
        globalProcess: {
          layer_height_mm: 0.2,
          wall_line_count: 4,
          infill_density_percent: 35,
          infill_pattern: "gyroid",
          nozzle_temp_c: 215,
          bed_temp_c: 60,
          fan_speed_percent: 80,
          custom_gcode: "M104 S0",
          huge_defaults: { values: Array(500).fill("unneeded") },
          speeds: {
            wall_outer: 40,
            wall_inner: 60,
            infill: 80,
            first_layer: 20,
            unsupported_speed_profile: "remove",
          },
        },
        perObjectOverrides: {},
      },
      userModifiedSettings: ["wall_line_count"],
      intentDetails: {
        primary_goal: "functional_strong",
        free_text_description: "Keep it robust for a load-bearing bracket.",
      },
      plateImages: [
        {
          name: "plate_1.png",
          dataUrl: `data:image/png;base64,${"x".repeat(90_000)}`,
        },
      ],
      allowUserSettingOverrides: false,
      targetLanguage: "en",
    };

    const result = buildCompactRequestMessages(fullPayload);
    const projectJson = result.messages[1].content[1].text;

    expect(projectJson).toContain('"layer_height_mm":0.2');
    expect(projectJson).toContain('"wall_line_count":4');
    expect(projectJson).toContain('"infill_density_percent":35');
    expect(projectJson).toContain('"wall_outer":40');
    expect(result.messages[1].content[0].text).toContain(
      "Keep it robust for a load-bearing bracket.",
    );
    expect(projectJson).not.toContain("custom_gcode");
    expect(projectJson).not.toContain("huge_defaults");
    expect(result.payload.plateImages).toEqual([]);
    expect(result.omitted).toMatchObject({
      plateImages: 1,
      customSettings: 3,
    });
    expect(result.estimatedInputTokens).toBeLessThan(
      COMPACT_CONTEXT_TARGET_TOKENS,
    );
    expect(result.messages[0].content.length).toBeLessThan(2_000);
  });

  it("fails safely when required user intent alone exceeds the compact budget", () => {
    const payload = {
      projectSummary: {},
      currentSettings: {},
      intentDetails: { free_text_description: "x".repeat(20_000) },
    };

    expect(() => buildCompactRequestMessages(payload)).toThrow(
      /above its 5500-token safety target/,
    );
    try {
      buildCompactRequestMessages(payload);
    } catch (error) {
      expect(error.code).toBe("COMPACT_CONTEXT_OVER_BUDGET");
      expect(error.estimatedInputTokens).toBeGreaterThan(
        COMPACT_CONTEXT_TARGET_TOKENS,
      );
    }
  });
});
