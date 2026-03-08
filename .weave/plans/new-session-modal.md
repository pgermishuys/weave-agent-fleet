# Convert New Session UI from Sheet to Centered Modal Dialog

## TL;DR
> **Summary**: Replace the right-sliding Sheet panel in `new-session-dialog.tsx` with a centered Dialog modal that matches the Command Palette's visual style (zoom+fade animation, backdrop, centered positioning).
> **Estimated Effort**: Quick

## Context
### Original Request
Convert the "New Session" UI from a right-sliding Sheet panel to a centered modal dialog, matching the style of the existing Command Palette modal.

### Key Findings
1. **Single file change** — only `src/components/session/new-session-dialog.tsx` needs modification. All 5 trigger sites use the component via its props (`trigger`, `open`, `onOpenChange`, `defaultDirectory`), which map 1:1 between Sheet and Dialog.
2. **Both Sheet and Dialog wrap the same Radix primitive** — `radix-ui`'s `Dialog`. Sheet is `sheet.tsx` line 5: `import { Dialog as SheetPrimitive } from "radix-ui"`, Dialog is `dialog.tsx` line 5: `import { Dialog as DialogPrimitive } from "radix-ui"`. Same `open`/`onOpenChange` API, same `Trigger` pattern with `asChild`.
3. **`DialogContent` already provides** the exact target visual: centered positioning (`fixed top-[50%] left-[50%] translate-x-[-50%] translate-y-[-50%]`), backdrop (`bg-black/50`), zoom+fade animation (`zoom-in-95`/`zoom-out-95`, `fade-in-0`/`fade-out-0`), close button, border, shadow, rounded corners.
4. **Existing Dialog usage pattern** confirmed in `install-skill-dialog.tsx` — uses `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle` with `className="sm:max-w-md"`.
5. **Sheet is only imported by `new-session-dialog.tsx`** — no other consumers. The `sheet.tsx` component file stays (it's a general UI component) but becomes unused for now.
6. **The trigger locations** all use either (a) `trigger` prop with `asChild` (header, sidebar collapsed, sidebar expanded) or (b) controlled `open`/`onOpenChange` (workspace context menu, command palette). Both patterns work identically with Dialog.

## Objectives
### Core Objective
Swap the Sheet wrapper for Dialog in `new-session-dialog.tsx` so the New Session form renders as a centered modal with zoom+fade animation instead of a right-sliding panel.

### Deliverables
- [ ] Updated `new-session-dialog.tsx` using Dialog components instead of Sheet components
- [ ] Visual match with Command Palette modal style (centered, backdrop, zoom+fade)
- [ ] Zero changes to trigger sites — all 5 continue to work as-is

### Definition of Done
- [ ] `npm run build` succeeds with no TypeScript errors
- [ ] Opening New Session from header button shows centered modal
- [ ] Opening New Session from sidebar (collapsed) shows centered modal
- [ ] Opening New Session from sidebar (expanded) shows centered modal
- [ ] Opening New Session from workspace context menu shows centered modal
- [ ] Opening New Session from command palette (keybinding) shows centered modal
- [ ] Escape key closes the modal
- [ ] Clicking backdrop closes the modal
- [ ] Form submission still works (creates session, navigates, closes modal)
- [ ] Focus is trapped within the modal while open

### Guardrails (Must NOT)
- Do NOT change any trigger sites (header.tsx, sidebar.tsx, sidebar-workspace-item.tsx, session-commands.tsx)
- Do NOT change form logic, state management, or hooks
- Do NOT change the `NewSessionDialogProps` interface
- Do NOT delete `sheet.tsx` (it's a general UI component that may be used elsewhere in future)

## TODOs

- [ ] 1. **Replace Sheet imports with Dialog imports in `new-session-dialog.tsx`**
  **What**: Change the import statement from Sheet components to Dialog components.
  **Files**: `src/components/session/new-session-dialog.tsx`
  **Details**:
  
  Replace lines 8–14:
  ```tsx
  import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
  } from "@/components/ui/sheet";
  ```
  With:
  ```tsx
  import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
  } from "@/components/ui/dialog";
  ```
  **Acceptance**: File compiles with no import errors.

- [ ] 2. **Replace Sheet JSX wrapper with Dialog wrapper**
  **What**: Swap the outer `<Sheet>` / `<SheetContent>` / `<SheetHeader>` / `<SheetTitle>` / `<SheetTrigger>` elements for their Dialog equivalents. Apply `sm:max-w-md` to size the modal appropriately for the form content.
  **Files**: `src/components/session/new-session-dialog.tsx`
  **Details**:
  
  Replace lines 115–119 (the opening wrapper):
  ```tsx
    <Sheet open={open} onOpenChange={setOpen}>
      {trigger && <SheetTrigger asChild>{trigger}</SheetTrigger>}
      <SheetContent side="right" className="w-full max-w-sm">
        <SheetHeader>
          <SheetTitle>New Session</SheetTitle>
        </SheetHeader>
  ```
  With:
  ```tsx
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Session</DialogTitle>
        </DialogHeader>
  ```

  Replace lines 226–228 (the closing wrapper):
  ```tsx
      </SheetContent>
    </Sheet>
  ```
  With:
  ```tsx
      </DialogContent>
    </Dialog>
  ```

  **Key differences**:
  - `Sheet` → `Dialog` (same `open`/`onOpenChange` API — both wrap Radix Dialog.Root)
  - `SheetTrigger` → `DialogTrigger` (same `asChild` prop)
  - `SheetContent side="right" className="w-full max-w-sm"` → `DialogContent className="sm:max-w-md"` (removes slide-from-right; Dialog already has centered positioning, zoom+fade, backdrop, close button, border/shadow from its defaults in `dialog.tsx` line 64)
  - `SheetHeader` → `DialogHeader`
  - `SheetTitle` → `DialogTitle`
  
  **Acceptance**: The modal renders centered with backdrop and zoom+fade animation. Form content is unchanged.

- [ ] 3. **Adjust form spacing for modal layout**
  **What**: The Sheet used `mt-6` on the form (line 122: `className="space-y-4 mt-6"`). In the Dialog, `DialogContent` already has `gap-4` and `p-6`, so the extra `mt-6` may produce excessive spacing. Reduce or remove it.
  **Files**: `src/components/session/new-session-dialog.tsx`
  **Details**:
  
  Replace line 122:
  ```tsx
        <form onSubmit={handleSubmit} className="space-y-4 mt-6">
  ```
  With:
  ```tsx
        <form onSubmit={handleSubmit} className="space-y-4">
  ```
  
  The `DialogContent` component uses `gap-4` (line 64 of dialog.tsx), which provides sufficient spacing between the header and the form. Removing `mt-6` aligns with the pattern used in `install-skill-dialog.tsx` (which uses `<div className="space-y-4 py-2">` after the header with no extra top margin).
  
  **Acceptance**: Visual spacing between header and form looks balanced (no excessive gap).

## Verification
- [ ] `npm run build` passes with no errors
- [ ] No regressions — all 5 trigger paths open the dialog correctly
- [ ] Modal visually matches the Command Palette style: centered, dark backdrop, zoom+fade animation, rounded border, shadow
- [ ] Accessibility: focus trapping works, Escape closes, backdrop click closes
- [ ] Form functionality unchanged: isolation strategy toggle, directory picker, branch input, title input, error display, submit button all work
- [ ] The `trigger` prop with `asChild` renders the trigger inline (not portalled) — same behavior as SheetTrigger
- [ ] Controlled mode (open/onOpenChange without trigger) works for workspace context menu and command palette paths
