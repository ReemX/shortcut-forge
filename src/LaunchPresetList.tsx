import { PanelSectionRow, ToggleField } from "@decky/ui";
import { useState } from "react";
import { FaFloppyDisk, FaPen, FaPlus, FaTrash, FaXmark } from "react-icons/fa6";
import { setCustomPresets } from "./backend";
import {
  countActivePresets,
  customPresetProblem,
  isCustomPresetOn,
  isPresetOn,
  LAUNCH_PRESETS,
  PRESET_GROUPS,
  presetOption,
  setCustomPreset,
  setPreset,
  type CustomPreset,
  type LaunchPreset,
} from "./launchPresets";
import { DisclosureRow, ListGroup, ListRow } from "./ListRow";
import { TextEntry } from "./TextEntry";

const NOTE_STYLE = { padding: "8px 16px 0", fontSize: "12px", opacity: 0.75 };

const OPTION_STYLE = {
  fontFamily: "monospace",
  fontSize: "11px",
  opacity: 0.6,
  overflowWrap: "anywhere",
} as const;

function GroupHeading({ children }: { children: string }) {
  return (
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
      {children}
    </div>
  );
}

function PresetDescription({ preset }: { preset: LaunchPreset }) {
  return (
    <>
      <div>{preset.useWhen}</div>
      {preset.tradeoff && <div style={{ opacity: 0.75 }}>Downside: {preset.tradeoff}</div>}
      <div style={OPTION_STYLE}>{presetOption(preset)}</div>
    </>
  );
}

function PresetEditor({
  preset,
  startingOptions,
  error,
  onSave,
  onDelete,
  onCancel,
}: {
  /** The preset being changed, or null when writing a new one. */
  preset: CustomPreset | null;
  startingOptions: string;
  /** Why the last save did not work. */
  error: string;
  onSave(alias: string, options: string): void;
  onDelete?(): void;
  onCancel(): void;
}) {
  const [alias, setAlias] = useState(preset?.alias ?? "");
  const [options, setOptions] = useState(preset?.options ?? startingOptions);
  const [problem, setProblem] = useState("");
  const [deleteArmed, setDeleteArmed] = useState(false);

  const save = () => {
    const found = customPresetProblem(alias, options);
    setProblem(found);
    if (!found) onSave(alias.trim(), options.trim());
  };

  const message = problem || error;

  return (
    <>
      <GroupHeading>{preset ? "Edit preset" : "New preset"}</GroupHeading>
      <PanelSectionRow>
        <TextEntry label="Name" value={alias} onChange={setAlias} />
      </PanelSectionRow>
      <PanelSectionRow>
        <TextEntry
          label="Launch options"
          value={options}
          onChange={setOptions}
          description="What you would type into Launch options, such as PROTON_LOG=1 %command%"
        />
      </PanelSectionRow>
      {message && <div style={NOTE_STYLE}>{message}</div>}
      <div style={{ height: "6px" }} />
      <ListGroup onBack={onCancel}>
        <ListRow icon={<FaFloppyDisk />} label="Save preset" onSelect={save} />
        <ListRow icon={<FaXmark />} label="Cancel" onSelect={onCancel} />
        {onDelete && (
          <ListRow
            icon={<FaTrash />}
            label={deleteArmed ? "Press again to delete" : "Delete preset"}
            onSelect={() => (deleteArmed ? onDelete() : setDeleteArmed(true))}
          />
        )}
      </ListGroup>
    </>
  );
}

/**
 * Named launch options that write into the field above them: the user's own
 * first, then the built-in workarounds.
 *
 * Collapsed by default and showing how many are on: most games need none, and
 * the list is too long to sit in the middle of the form.
 */
export function LaunchPresets({
  options,
  usesProton,
  onChange,
  custom,
  onCustomChange,
}: {
  options: string;
  usesProton: boolean;
  onChange(next: string): void;
  custom: CustomPreset[];
  onCustomChange(next: CustomPreset[]): void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [managing, setManaging] = useState(false);
  /** The preset open in the editor, "new" for a blank one, or null when closed. */
  const [editing, setEditing] = useState<CustomPreset | "new" | null>(null);
  const [saveError, setSaveError] = useState("");

  const activeCount = countActivePresets(options, custom);
  // One that is already on stays listed, or it could not be turned off again.
  const visible = LAUNCH_PRESETS.filter(
    (preset) => usesProton || !preset.protonOnly || isPresetOn(preset, options),
  );

  const closeEditor = () => {
    setEditing(null);
    setSaveError("");
  };

  const store = async (next: CustomPreset[]): Promise<boolean> => {
    try {
      onCustomChange(await setCustomPresets(next));
      return true;
    } catch (error) {
      console.error("[add-non-steam-games] could not save custom presets", error);
      setSaveError("Could not save. The plugin's backend is not responding.");
      return false;
    }
  };

  const savePreset = async (alias: string, text: string) => {
    if (editing === "new") {
      const created = { id: `custom-${Date.now().toString(36)}`, alias, options: text };
      if (await store([...custom, created])) closeEditor();
      return;
    }
    if (!editing) return;
    const updated = { ...editing, alias, options: text };
    if (!(await store(custom.map((preset) => (preset.id === updated.id ? updated : preset))))) return;
    // A preset that is on keeps working for this game after being edited.
    if (isCustomPresetOn(editing, options)) {
      onChange(setCustomPreset(updated, setCustomPreset(editing, options, false), true));
    }
    closeEditor();
  };

  const deletePreset = async (target: CustomPreset) => {
    if (await store(custom.filter((preset) => preset.id !== target.id))) {
      closeEditor();
      if (custom.length <= 1) setManaging(false);
    }
  };

  return (
    <>
      <DisclosureRow
        label="Launch option presets"
        trailing={activeCount > 0 ? `${activeCount} on` : undefined}
        expanded={expanded}
        onToggle={() => setExpanded(!expanded)}
      />

      {expanded && (
        <>
          <GroupHeading>Your presets</GroupHeading>

          {custom.map((preset) => (
            <PanelSectionRow key={preset.id}>
              <ToggleField
                label={preset.alias}
                description={<div style={OPTION_STYLE}>{preset.options}</div>}
                checked={isCustomPresetOn(preset, options)}
                onChange={(on) => onChange(setCustomPreset(preset, options, on))}
              />
            </PanelSectionRow>
          ))}

          {editing ? (
            <PresetEditor
              key={editing === "new" ? "new" : editing.id}
              preset={editing === "new" ? null : editing}
              startingOptions={options}
              error={saveError}
              onSave={savePreset}
              onDelete={editing === "new" ? undefined : () => deletePreset(editing)}
              onCancel={closeEditor}
            />
          ) : (
            <>
              {custom.length === 0 && (
                <div style={NOTE_STYLE}>
                  Save launch options you use often, so you can turn them on for any game.
                </div>
              )}
              <div style={{ height: "6px" }} />
              <ListGroup>
                <ListRow icon={<FaPlus />} label="New preset" onSelect={() => setEditing("new")} />
                {custom.length > 0 && (
                  <ListRow
                    icon={<FaPen />}
                    label={managing ? "Hide editing" : "Edit your presets"}
                    onSelect={() => setManaging(!managing)}
                  />
                )}
                {managing &&
                  custom.map((preset) => (
                    <ListRow
                      key={preset.id}
                      icon={<FaPen />}
                      label={preset.alias}
                      onSelect={() => setEditing(preset)}
                    />
                  ))}
              </ListGroup>
            </>
          )}

          <div style={NOTE_STYLE}>
            Most games need none of these. Turn on one at a time, only for a problem you actually
            have. Each one is added to Launch options above, where you can see or edit it.
            {!usesProton && " Choose a Proton version to see the Proton fixes."}
          </div>

          {PRESET_GROUPS.map((group) => {
            const presets = visible.filter((preset) => preset.group === group);
            if (presets.length === 0) return null;
            return (
              <div key={group}>
                <GroupHeading>{group}</GroupHeading>
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
