/** What every server action returns to its form. Shared by server and client code. */
export interface ActionState {
  ok: boolean;
  error?: string;
  message?: string;
  /** Free-form — e.g. the id of what was created, or a hint such as "duplicate". */
  data?: Record<string, unknown>;
}

export const initialState: ActionState = { ok: false };
