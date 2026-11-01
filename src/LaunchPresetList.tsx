import { PanelSectionRow, ToggleField } from "@decky/ui";
import { useState } from "react";
import {
  countActivePresets,
  isPresetOn,
  LAUNCH_PRESETS,
  PRESET_GROUPS,
  presetOption,
  setPreset,
  type LaunchPreset,
} from "./launchPresets";
import { DisclosureRow } from "./ListRow";

function PresetDescription({ preset }: { preset: LaunchPreset }) {
  return (
    <>
      <div>{preset.useWhen}</div>
      {preset.tradeoff && <div style={{ opacity: 0.75 }}>Downside: {preset.tradeoff}</div>}
      <div style={{ fontFamily: "monospace", fontSize: "11px", opacity: 0.6, overflowWrap: "anywhere" }}>
        {presetOption(preset)}
      </div>
    </>
  );
}

/**
 * Named workarounds that write into the launch options field above them.
 *
 * Collapsed by default and showing how many are on: most games need none, and
 * the list is too long to sit in the middle of the form.
 */
export function LaunchPresets({
  options,
  usesProton,
  onChange,
}: {
  options: string;
  usesProton: boolean;
  onChange(next: string): void;
}) {
  const [expanded, setExpanded] = useState(false);

  const activeCount = countActivePresets(options);
  // One that is already on stays listed, or it could not be turned off again.
  const visible = LAUNCH_PRESETS.filter(
    (preset) => usesProton || !preset.protonOnly || isPresetOn(preset, options),
  );

  return (
    <>
      <DisclosureRow
        label="Launch option fixes"
        trailing={activeCount > 0 ? `${activeCount} on` : undefined}
        expanded={expanded}
        onToggle={() => setExpanded(!expanded)}
      />

      {expanded && (
        <>
          <div style={{ padding: "8px 16px 0", fontSize: "12px", opacity: 0.75 }}>
            Most games need none of these. Turn on one at a time, only for a problem you actually
            have. Each one is added to Launch options above, where you can see or edit it.
            {!usesProton && " Choose a Proton version to see the Proton fixes."}
          </div>

          {PRESET_GROUPS.map((group) => {
            const presets = visible.filter((preset) => preset.group === group);
            if (presets.length === 0) return null;
            return (
              <div key={group}>
                <div
                  style={{
                    padding: "12px 16px 2px",
                    fontSize: "11px",
                    fontWeight: 600,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    opacity: 0.6,
                  }}
                >
                  {group}
                </div>
                {presets.map((preset) => (
                  <PanelSectionRow key={preset.id}>
                    <ToggleField
                      label={preset.alias}
                      description={<PresetDescription preset={preset} />}
                      checked={isPresetOn(preset, options)}
                      onChange={(on) => onChange(setPreset(preset, options, on))}
                    />
                  </PanelSectionRow>
                ))}
              </div>
            );
          })}
        </>
      )}
    </>
  );
}
