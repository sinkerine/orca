# Missing banners and scroll context repair

Base observed during work: a0befb9d876f (original feature committed separately during session). Parent edits only this worktree.

Root causes: history was tied to banner effect lifetime, mounted/replayed terminals only had latest status without earlier prompts, replay positions were refined only on click, and session-boundary statuses deleted readable context.

Repair: terminal-instance WeakMap retention; keep context after agent session boundary; seed up to 200 user prompts through existing nativeChat.readSession on the execution host; one bounded viewport buffer walk resolves all candidate texts on changed viewport/buffer cursor; select greatest preceding marker line rather than array order. Mobile buffers transcript seeds until terminal attachment. Short transcript prompts require prompt-like row prefixes before accepting a text match. Missing status does not erase context. Unsupported transcript providers keep observed live history.

VM s1-091c3e91, hidden Electron/CDP, ORCA_BACKGROUND_LAUNCH=1. Controlled rendered replay with two prompts and 45 response rows each, seeded after mount. At viewport 10 banner showed Historical first prompt; at viewport 55 showed Latest second prompt without any banner click. Screenshot first-prompt.png. This validates shared matcher and desktop subscription/layout; current mobile changes have typecheck and regression tests, not a new Android rendered run.

Verification: 15 focused tests pass (history/remount/order/replay, component, checked transcript parsing); 21 existing mobile document/layout tests pass; desktop and mobile typechecks pass; changed-code quality and formatting results retained here. Independent Claude review findings addressed: attach race, position-order selection, repeated buffer walks, short seed matching, repeated prompt identity, unsupported mobile providers.

Limits: missing provider status/session identity cannot reconstruct unknown prompts; transcript read is bounded to 200 entries; boxed/rewritten prompt text may not match, and alternate screen only supports latest known prompt. No provider screen syntax was inferred from remembered screenshots. No new RPC or remote wire fields.
