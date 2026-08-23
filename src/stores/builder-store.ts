"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  emptyDocument,
  type EditorDocument,
} from "@/lib/diagram/editor/document";

/**
 * The editor's state: one document, a history of it, and what is selected.
 *
 * UNDO IS A STACK OF WHOLE DOCUMENTS, not a stack of inverse operations. The
 * document is a few kilobytes of plain JSON and every operation in `ops.ts`
 * already returns a fresh one, so a snapshot costs a shallow copy and an undo is
 * a pop — whereas hand-written inverse operations are a second implementation of
 * every command, and the bugs live in the pairs that disagree. `group()` alone
 * would need an inverse that rebuilt six things in the right order.
 *
 * The one thing a snapshot stack needs care with is DRAGGING: a pointermove that
 * pushed history would put four hundred entries on the stack for one gesture. So
 * changes come in two flavours — `commit` (a step you can undo) and `set` (a
 * continuation of the step already in progress) — and a drag pushes once, at the
 * start.
 */

const HISTORY_LIMIT = 100;

interface BuilderState {
  doc: EditorDocument;
  past: EditorDocument[];
  future: EditorDocument[];

  /** Instance ids. */
  selection: string[];
  selectedLink: string | null;

  /**
   * The equation box's contents. In the store rather than in the panel because
   * the panel is inside a tab, and a tab that unmounts would throw away what
   * somebody had typed the moment they looked at the style settings.
   */
  specText: string;
  setSpecText: (text: string) => void;

  /** A new undoable step. */
  commit: (next: EditorDocument) => void;
  /** Continue the step already on the stack — used for every frame of a drag. */
  set: (next: EditorDocument) => void;
  /** Push the CURRENT document, so the following `set` calls are one step. */
  beginStep: () => void;

  undo: () => void;
  redo: () => void;

  select: (ids: string[]) => void;
  toggle: (id: string) => void;
  selectLink: (id: string | null) => void;
  clearSelection: () => void;

  replaceDocument: (doc: EditorDocument) => void;
  rename: (title: string) => void;
  reset: () => void;
}

export const useBuilderStore = create<BuilderState>()(
  persist(
    (setState, get) => ({
      doc: emptyDocument(),
      past: [],
      future: [],
      selection: [],
      selectedLink: null,

      specText: "F(A,B,C) = Σm(1,2,4,7)",
      setSpecText: (specText) => setState({ specText }),

      commit: (next) =>
        setState((s) => ({
          doc: next,
          past: [...s.past, s.doc].slice(-HISTORY_LIMIT),
          // Any new edit invalidates the redo branch — the standard rule, and the
          // one people expect from every other editor they have used.
          future: [],
        })),

      set: (next) => setState({ doc: next }),

      beginStep: () =>
        setState((s) => ({
          past: [...s.past, s.doc].slice(-HISTORY_LIMIT),
          future: [],
        })),

      undo: () => {
        const { past, doc, future } = get();
        const previous = past[past.length - 1];
        if (!previous) return;
        setState({
          doc: previous,
          past: past.slice(0, -1),
          future: [doc, ...future].slice(0, HISTORY_LIMIT),
          // A selection can name a block that the undone step created.
          selection: [],
          selectedLink: null,
        });
      },

      redo: () => {
        const { past, doc, future } = get();
        const next = future[0];
        if (!next) return;
        setState({
          doc: next,
          past: [...past, doc].slice(-HISTORY_LIMIT),
          future: future.slice(1),
          selection: [],
          selectedLink: null,
        });
      },

      select: (selection) => setState({ selection, selectedLink: null }),
      toggle: (id) =>
        setState((s) => ({
          selection: s.selection.includes(id)
            ? s.selection.filter((x) => x !== id)
            : [...s.selection, id],
          selectedLink: null,
        })),
      selectLink: (selectedLink) => setState({ selectedLink, selection: [] }),
      clearSelection: () => setState({ selection: [], selectedLink: null }),

      replaceDocument: (doc) =>
        setState((s) => ({
          doc,
          past: [...s.past, s.doc].slice(-HISTORY_LIMIT),
          future: [],
          selection: [],
          selectedLink: null,
        })),

      rename: (title) =>
        setState((s) => ({
          doc: { ...s.doc, title },
          past: [...s.past, s.doc].slice(-HISTORY_LIMIT),
          future: [],
        })),

      reset: () =>
        setState((s) => ({
          doc: emptyDocument(),
          past: [...s.past, s.doc].slice(-HISTORY_LIMIT),
          future: [],
          selection: [],
          selectedLink: null,
        })),
    }),
    {
      name: "gatelab-builder",
      version: 1,
      // Only the document survives a reload. History is a session's worth of
      // intent, not part of the drawing, and persisting it would mean an undo
      // after a reload jumping to a state the user has no memory of.
      partialize: (s) => ({ doc: s.doc, specText: s.specText }),
    },
  ),
);
