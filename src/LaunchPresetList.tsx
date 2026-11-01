import { PanelSectionRow } from "@decky/ui";
import { useState, type ReactNode } from "react";
import { FaFloppyDisk, FaPlus, FaTrash, FaXmark } from "react-icons/fa6";
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
import { GroupHeading, ListGroup, ListRow, ListScroller, Screen, ScreenHeader, ToggleRow } from "./ListRow";
import { TextEntry } from "./TextEntry";

const OPTION_STYLE = {
  fontFamily: "monospace",
  fontSize: "11px",
  opacity: 0.65,
  overflowWrap: "anywhere",
  marginTop: "2px",
} as const;

/**
 * Sizes for the screen to fit the panel exactly: the list scrolls by whole rows
 * while the explanation stays put, so moving down never shifts anything else.
 */
const LIST_HEIGHT = 262;
const DETAIL_HEIGHT = 86;

function BuiltInDetail({ preset }: { preset: LaunchPreset }) {
  return (
    <>
      <div>{preset.useWhen}</div>
      {preset.tradeoff && <div style={{ opacity: 0.7 }}>Downside: {preset.tradeoff}</div>}
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
    <Screen onBack={onCancel}>
      <ScreenHeader title={preset ? "Edit preset" : "New preset"} onBack={onCancel} />
      <PanelSectionRow>
        <TextEntry label="Name" value={alias} onChange={setAlias} />
      </PanelSectionRow>
      <PanelSectionRow>
        <TextEntry
          label="Launch options"
          value={options}
          onChange={setOptions}
          description="As you would type them, such as PROTON_LOG=1 %command%"
        />
      </PanelSectionRow>
      {message && <div style={{ padding: "4px 0", fontSize: "12px", color: "#e8b23a" }}>{message}</div>}
      <div style={{ height: "6px" }} />
      <ListGroup>
        <ListRow icon={<FaFloppyDisk />} label="Save preset" takeFocus onSelect={save} />
        <ListRow icon={<FaXmark />} label="Cancel" onSelect={onCancel} />
        {onDelete && (
          <ListRow
            icon={<FaTrash />}
            label={deleteArmed ? "Press again to delete" : "Delete preset"}
            onSelect={() => (deleteArmed ? onDelete() : setDeleteArmed(true))}
          />
        )}
      </ListGroup>
    </Screen>
  );
}

/**
 * The launch options, with named presets that write into them: the user's own
 * first, then the built-in workarounds.
 *
 * Its own screen, since a list this long has no place in the middle of a form.
 */
export function LaunchOptionsScreen({
  options,
  usesProton,
  onChange,
  custom,
  onCustomChange,
  onBack,
}: {
  options: string;
  usesProton: boolean;
  onChange(next: string): void;
  custom: CustomPreset[];
  onCustomChange(next: CustomPreset[]): void;
  onBack(): void;
}) {
  /** The preset open in the editor, "new" for a blank one, or null when closed. */
  const [editing, setEditing] = useState<CustomPreset | "new" | null>(null);
  const [saveError, setSaveError] = useState("");
  const [detail, setDetail] = useState<ReactNode>(null);

  const activeCount = countActivePresets(options, custom);
  // One that is already on stays listed, or it could not be turned off again.
  const visible = LAUNCH_PRESETS.filter(
    (preset) => usesProton || !preset.protonOnly || isPresetOn(preset, options),
  );

  const closeEditor = () => {
    setEditing(null);
    setSaveError("");
    setDetail(null);
  };

  const store = async (next: CustomPreset[]): Promise<boolean> => {
    try {
      onCustomChange(await setCustomPresets(next));
      return true;
    } catch (error) {
      console.error("[shortcut-forge] could not save custom presets", error);
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
    if (await store(custom.filter((preset) => preset.id !== target.id))) closeEditor();
  };

  if (editing) {
    return (
      <PresetEditor
        key={editing === "new" ? "new" : editing.id}
        preset={editing === "new" ? null : editing}
        startingOptions={options}
        error={saveError}
        onSave={savePreset}
        onDelete={editing === "new" ? undefined : () => deletePreset(editing)}
        onCancel={closeEditor}
      />
    );
  }

  return (
    <Screen onBack={onBack}>
      <ScreenHeader title="Launch options" trailing={activeCount > 0 ? `${activeCount} on` : undefined} onBack={onBack} />

      <ListScroller height={LIST_HEIGHT}>
        <div onFocus={() => setDetail(null)}>
          <PanelSectionRow>
            <TextEntry label="As text" value={options} onChange={onChange} />
          </PanelSectionRow>
        </div>

        <GroupHeading>Your presets</GroupHeading>
        <ListGroup>
          {custom.map((preset, index) => (
            <ToggleRow
              key={preset.id}
              label={preset.alias}
              checked={isCustomPresetOn(preset, options)}
              takeFocus={index === 0}
              onChange={(on) => onChange(setCustomPreset(preset, options, on))}
              onFocused={() =>
                setDetail(
                  <>
                    <div>Your preset. Press X to edit it.</div>
                    <div style={OPTION_STYLE}>{preset.options}</div>
                  </>,
                )
              }
              secondaryLabel="Edit preset"
              onSecondary={() => setEditing(preset)}
            />
          ))}
          <div onFocus={() => setDetail("Save launch options you use often, so you can turn them on for any game.")}>
            <ListRow icon={<FaPlus />} label="New preset" takeFocus={custom.length === 0} onSelect={() => setEditing("new")} />
          </div>
        </ListGroup>

        {PRESET_GROUPS.map((group) => {
          const presets = visible.filter((preset) => preset.group === group);
          if (presets.length === 0) return null;
          return (
            <div key={group}>
              <GroupHeading>{group}</GroupHeading>
              <ListGroup>
                {presets.map((preset) => (
                  <ToggleRow
                    key={preset.id}
                    label={preset.alias}
                    checked={isPresetOn(preset, options)}
                    onChange={(on) => onChange(setPreset(preset, options, on))}
                    onFocused={() => setDetail(<BuiltInDetail preset={preset} />)}
                  />
                ))}
              </ListGroup>
            </div>
          );
        })}
        {!usesProton && (
          <div style={{ padding: "8px 0", fontSize: "12px", opacity: 0.7 }}>
            Choose a Proton version to see the Proton fixes.
          </div>
        )}
      </ListScroller>

      <div
        style={{
          height: `${DETAIL_HEIGHT}px`,
          boxSizing: "border-box",
          marginTop: "4px",
          padding: "6px 2px 0",
          borderTop: "1px solid rgba(255,255,255,.14)",
          fontSize: "12px",
          lineHeight: "15px",
          overflow: "hidden",
        }}
      >
        {detail ?? "Most games need none of these. Turn on one at a time, only for a problem you actually have."}
      </div>
    </Screen>
  );
}
