import { LLM_RESPONSE_FORMAT } from "./responseSchema.js";

export const COMPACT_CONTEXT_TARGET_TOKENS = 5_500;

const CORE_SETTINGS = [
  "layer_height_mm",
  "first_layer_height_mm",
  "wall_line_count",
  "line_width",
  "outer_wall_line_width",
  "inner_wall_line_width",
  "top_layers",
  "bottom_layers",
  "top_surface_pattern",
  "bottom_surface_pattern",
  "infill_density_percent",
  "infill_pattern",
  "sparse_infill_line_width",
  "nozzle_temp_c",
  "bed_temp_c",
  "fan_speed_percent",
  "first_layers_fan_percent",
  "overhang_fan_speed",
  "supports_enabled",
  "support_threshold_angle",
  "support_style",
  "support_top_z_distance",
  "adhesion_type",
  "brim_width",
  "speeds",
  "top_surface_speed",
  "bridge_speed",
  "travel_speed",
  "support_speed",
  "travel_acceleration",
  "outer_wall_acceleration",
  "inner_wall_acceleration",
  "sparse_infill_acceleration",
  "initial_layer_acceleration",
  "retraction_length",
  "retraction_speed",
  "z_hop",
  "filament_flow_ratio",
  "print_flow_ratio",
  "initial_layer_flow_ratio",
  "bridge_flow",
  "pressure_advance",
  "seam_position",
];
const SPEED_SETTINGS = ["wall_outer", "wall_inner", "infill", "first_layer"];
const MAX_PROJECT_OBJECTS = 30;
const MAX_FILAMENTS = 8;
const COMPACT_SYSTEM_PROMPT = `You are Slicer Copilot, an expert FDM 3D-printing settings optimizer. Recommend concise, safe changes using this project and user intent.
Rules: change print settings only, never geometry; respect printer, nozzle, material, and bed limits; honor constraints and userModifiedSettings unless allowUserSettingOverrides is true; only use parameters present in currentSettings; keep changes minimal and useful; write human-readable text in targetLanguage and keep parameter names unchanged. Return strict JSON matching the provided schema.`;

/**
 * Reduce the project to the settings that materially guide print optimization.
 * User intent, locked-setting names, core settings, and basic object identity
 * remain intact; images and verbose/custom slicer defaults are omitted.
 *
 * @param {object} payload Full optimizer payload.
 * @returns {object} Compact payload with an estimate and omitted-item counts.
 */
export function compactContextPayload(payload) {
  const projectSummary = compactProjectSummary(payload.projectSummary ?? {});
  const currentSettings = compactSettings(payload.currentSettings ?? {});
  const compact = {
    version: payload.version,
    projectSummary,
    currentSettings,
    userModifiedSettings: payload.userModifiedSettings ?? [],
    intentDetails: payload.intentDetails ?? {},
    plateImages: [],
    allowUserSettingOverrides: payload.allowUserSettingOverrides === true,
    targetLanguage: payload.targetLanguage ?? "en",
  };
  const omittedObjects =
    countObjects(payload.projectSummary) - countObjects(projectSummary);
  const estimatedInputTokens = estimateInputTokens(compact);
  if (estimatedInputTokens > COMPACT_CONTEXT_TARGET_TOKENS) {
    const error = new Error(
      `Compact context is still estimated at ${estimatedInputTokens} tokens, above its ${COMPACT_CONTEXT_TARGET_TOKENS}-token safety target. Shorten custom intent text or inspect/copy the full prompt for a manual workflow.`,
    );
    error.code = "COMPACT_CONTEXT_OVER_BUDGET";
    error.estimatedInputTokens = estimatedInputTokens;
    throw error;
  }
  return {
    payload: compact,
    estimatedInputTokens,
    targetInputTokens: COMPACT_CONTEXT_TARGET_TOKENS,
    omitted: {
      plateImages: (payload.plateImages ?? []).length,
      customSettings: countCustomSettings(payload.currentSettings),
      objects: omittedObjects,
      filaments: Math.max(
        0,
        (payload.projectSummary?.filaments ?? []).length - MAX_FILAMENTS,
      ),
    },
  };
}

export function buildCompactRequestMessages(payload) {
  const result = compactContextPayload(payload);
  return {
    ...result,
    messages: [
      { role: "system", content: COMPACT_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Full user requirements:\n${JSON.stringify(result.payload.intentDetails)}`,
          },
          {
            type: "text",
            text: `Compact project data (JSON):\n${JSON.stringify({
              version: result.payload.version,
              projectSummary: result.payload.projectSummary,
              currentSettings: result.payload.currentSettings,
              userModifiedSettings: result.payload.userModifiedSettings,
              allowUserSettingOverrides:
                result.payload.allowUserSettingOverrides,
              targetLanguage: result.payload.targetLanguage,
            })}`,
          },
        ],
      },
    ],
  };
}

function compactProjectSummary(summary) {
  return {
    fileName: summary.fileName,
    printer: pick(summary.printer, [
      "name",
      "nozzle_diameter_mm",
      "bed_type",
      "bed_size_mm",
    ]),
    filaments: (summary.filaments ?? [])
      .slice(0, MAX_FILAMENTS)
      .map((filament) =>
        pick(filament, [
          "id",
          "name",
          "material_family",
          "nozzle_temp_recommended_range_c",
          "bed_temp_recommended_range_c",
        ]),
      ),
    base_profile: summary.base_profile ?? null,
    plates: (summary.plates ?? []).map((plate) => ({
      index: plate.index,
      name: plate.name,
      objects: (plate.objects ?? [])
        .slice(0, MAX_PROJECT_OBJECTS)
        .map((object) => ({
          name: object.name,
          plateIndex: object.plateIndex ?? plate.index,
          geometry: pick(object.geometry, [
            "bounding_box_mm",
            "max_dimension_mm",
            "min_dimension_mm",
            "height_to_min_footprint_ratio",
            "is_slender",
          ]),
        })),
    })),
  };
}

function compactSettings(settings) {
  const globalProcess = pick(settings.globalProcess, CORE_SETTINGS);
  if (globalProcess.speeds) {
    globalProcess.speeds = pick(globalProcess.speeds, SPEED_SETTINGS);
  }
  const perObjectOverrides = Object.fromEntries(
    Object.entries(settings.perObjectOverrides ?? {}).map(([key, value]) => {
      const selected = pick(value, [
        ...CORE_SETTINGS.filter((name) => name !== "speeds"),
        "plateIndex",
        "objectName",
      ]);
      if (value?.speeds) selected.speeds = pick(value.speeds, SPEED_SETTINGS);
      return [key, selected];
    }),
  );
  return { globalProcess, perObjectOverrides };
}

function pick(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    keys
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, value[key]]),
  );
}

function countObjects(summary = {}) {
  return (summary.plates ?? []).reduce(
    (total, plate) =>
      total + Math.max(0, (plate.objects ?? []).length - MAX_PROJECT_OBJECTS),
    0,
  );
}

function countCustomSettings(settings = {}) {
  const count = (object) =>
    Object.keys(object ?? {}).filter(
      (key) =>
        key !== "speeds" &&
        !CORE_SETTINGS.includes(key) &&
        key !== "objectName" &&
        key !== "plateIndex",
    ).length;
  return (
    count(settings.globalProcess) +
    Object.keys(settings.globalProcess?.speeds ?? {}).filter(
      (key) => !SPEED_SETTINGS.includes(key),
    ).length +
    Object.values(settings.perObjectOverrides ?? {}).reduce(
      (total, value) =>
        total +
        count(value) +
        (value?.speeds
          ? Object.keys(value.speeds).filter(
              (key) => !SPEED_SETTINGS.includes(key),
            ).length
          : 0),
      0,
    )
  );
}

function estimateInputTokens(payload) {
  const text = JSON.stringify(payload);
  const schema = JSON.stringify(LLM_RESPONSE_FORMAT);
  return Math.ceil(
    (text.length + schema.length + COMPACT_SYSTEM_PROMPT.length) / 3,
  );
}
