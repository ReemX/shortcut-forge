import { ConfirmModal, ToggleField } from "@decky/ui";
import { useState } from "react";

interface RestartPromptProps {
  gameName: string;
  /**
   * @param restart Whether to restart Steam now.
   * @param remember Whether that answer becomes the standing preference.
   */
  onDecision(restart: boolean, remember: boolean): void;
  closeModal?(): void;
}

/**
 * Asked after a game is added when the user chose "Ask each time". The game is
 * already saved by then; a shortcut's icon is the one thing Steam only reads at
 * startup.
 */
export function RestartPrompt({ gameName, onDecision, closeModal }: RestartPromptProps) {
  const [remember, setRemember] = useState(false);

  return (
    <ConfirmModal
      strTitle="Restart Steam?"
      strDescription={`"${gameName}" is in your library and saved. Restarting Steam makes its icon appear, and nothing else depends on it.`}
      strOKButtonText="Restart now"
      strCancelButtonText="Not now"
      closeModal={closeModal}
      onOK={() => onDecision(true, remember)}
      onCancel={() => onDecision(false, remember)}
    >
      <ToggleField
        label="Remember my choice"
        description="Do the same after every game without asking. You can change this later under Options."
        checked={remember}
        onChange={setRemember}
      />
    </ConfirmModal>
  );
}
