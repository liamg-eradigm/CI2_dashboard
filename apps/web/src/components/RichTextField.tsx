import { useEffect, useRef, type CSSProperties, type FocusEvent, type MouseEvent as ReactMouseEvent } from "react";
import { Extension, EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import { FontSize, TextStyle } from "@tiptap/extension-text-style";
import { Placeholder } from "@tiptap/extensions";
import { ListKeymap } from "@tiptap/extension-list";
import { stepFontSize } from "@eradigm/shared";
import { fromDoc, toDoc } from "../lib/richDoc";

/** Shown under formatted-text fields (and read out with them). */
export const RICH_HINT = "Select text to format it (bold, underline, size, title) · Bullets: Tab indents · Shift+Tab outdents · Esc then Tab leaves the field";

/** The font size (em) of the selection, 1 when it has none. */
const sizeOf = (editor: Editor) => {
  const v = Number.parseFloat(String(editor.getAttributes("textStyle").fontSize ?? ""));
  return Number.isFinite(v) ? v : 1;
};

/** Larger / smaller text for the selection, one step at a time (normal size clears the mark). */
function stepSize(editor: Editor, dir: 1 | -1) {
  const next = stepFontSize(sizeOf(editor), dir);
  const chain = editor.chain().focus();
  if (next === 1) chain.unsetFontSize().run();
  else chain.setFontSize(`${next}em`).run();
}

/** Ctrl/Cmd+Shift+> and < change the size, as in Word. */
const SizeKeys = Extension.create({
  name: "sizeKeys",
  addKeyboardShortcuts() {
    return {
      "Mod-Shift-.": () => (stepSize(this.editor, 1), true),
      "Mod-Shift-,": () => (stepSize(this.editor, -1), true),
    };
  },
});

/**
 * Word-style bullets, as in the plain text boxes before (request 19): Tab makes
 * a line a bullet or nests it one level, Shift+Tab un-nests it (and turns a
 * top-level bullet back into a line). Press Esc first to Tab out of the field,
 * so the keyboard never gets stuck in it.
 */
const ListKeys = Extension.create({
  name: "listKeys",
  priority: 1000,
  addStorage() {
    return { released: false };
  },
  addKeyboardShortcuts() {
    const inList = () => this.editor.isActive("listItem");
    return {
      Escape: () => {
        if (this.storage.released) return false;
        this.storage.released = true;
        return true;
      },
      Tab: () => {
        if (this.storage.released) {
          this.storage.released = false;
          return false;
        }
        if (inList()) this.editor.commands.sinkListItem("listItem");
        else this.editor.commands.toggleBulletList();
        return true;
      },
      "Shift-Tab": () => {
        if (this.storage.released) {
          this.storage.released = false;
          return false;
        }
        if (inList()) this.editor.commands.liftListItem("listItem");
        return true;
      },
    };
  },
  onSelectionUpdate() {
    this.storage.released = false;
  },
  onUpdate() {
    this.storage.released = false;
  },
});

/** The buttons over a selection: only while text is selected in an editable field. */
function FormatBar({ editor }: { editor: Editor }) {
  const st = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      underline: e.isActive("underline"),
      title: e.isActive("heading", { level: 3 }),
      size: sizeOf(e),
    }),
  });
  // Keep the selection: a press on a button must not take the focus from the text.
  const keep = (e: ReactMouseEvent) => e.preventDefault();
  const btn = (label: string, text: string, on: boolean | undefined, run: () => void, testId: string, extra?: string) => (
    <button type="button" className={`fmt-btn${extra ? ` ${extra}` : ""}`} aria-label={label} title={label} aria-pressed={on} onMouseDown={keep} onClick={run} data-testid={testId}>
      {text}
    </button>
  );
  return (
    <BubbleMenu
      editor={editor}
      shouldShow={({ editor: e, state }) => e.isEditable && !state.selection.empty && e.isFocused}
      className="fmt-bar"
      role="toolbar"
      aria-label="Format the selected text"
      data-testid="format-bar"
    >
      {btn("Bold (Ctrl+B)", "B", st.bold, () => editor.chain().focus().toggleBold().run(), "fmt-bold", "b")}
      {btn("Underline (Ctrl+U)", "U", st.underline, () => editor.chain().focus().toggleUnderline().run(), "fmt-underline", "u")}
      <span className="fmt-sep" aria-hidden="true" />
      {btn("Smaller text (Ctrl+Shift+<)", "A−", undefined, () => stepSize(editor, -1), "fmt-smaller", "small")}
      <span className="fmt-size" aria-live="polite" title="Text size">
        {Math.round(st.size * 100)}%
      </span>
      {btn("Larger text (Ctrl+Shift+>)", "A+", undefined, () => stepSize(editor, 1), "fmt-larger", "big")}
      <span className="fmt-sep" aria-hidden="true" />
      {btn("Title (make the line a title)", "Title", st.title, () => editor.chain().focus().toggleHeading({ level: 3 }).run(), "fmt-title", "title")}
    </BubbleMenu>
  );
}

export interface RichTextFieldProps {
  value: string;
  onValueChange: (v: string) => void;
  id?: string;
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
  /** Height in lines before it grows. */
  rows?: number;
  autoFocus?: boolean;
  placeholder?: string;
  /** data-testid of the editable text. */
  testId?: string;
  onBlur?: (e: FocusEvent<HTMLDivElement>) => void;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
}

/**
 * Request 46: every editing text box is a formatted-text field. Select text
 * and a small bar offers Bold, Underline, smaller / larger text and Title
 * (the size of a title can be changed too); "- " starts a bullet, nested
 * with Tab / Shift+Tab, and Enter continues it. The value is plain text with
 * light markup (see `@eradigm/shared` richText), so it is read as text
 * everywhere else.
 */
export function RichTextField({ value, onValueChange, id, className = "", style, disabled = false, rows = 4, autoFocus = false, placeholder, testId, onBlur, ...aria }: RichTextFieldProps) {
  const placeholderRef = useRef(placeholder ?? "");
  placeholderRef.current = placeholder ?? "";
  const last = useRef(value);
  const change = useRef(onValueChange);
  change.current = onValueChange;
  const attributes = (): Record<string, string> => {
    const a: Record<string, string> = { class: `rt-editor ${className}`.trim(), role: "textbox", "aria-multiline": "true", "data-rich": "" };
    if (id) a.id = id;
    if (testId) a["data-testid"] = testId;
    if (aria["aria-label"]) a["aria-label"] = aria["aria-label"];
    if (aria["aria-labelledby"]) a["aria-labelledby"] = aria["aria-labelledby"];
    if (aria["aria-describedby"]) a["aria-describedby"] = aria["aria-describedby"];
    if (aria["aria-invalid"] === true || aria["aria-invalid"] === "true") a["aria-invalid"] = "true";
    if (disabled) a["aria-disabled"] = "true";
    return a;
  };
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        blockquote: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        italic: false,
        strike: false,
        link: false,
        trailingNode: false,
        listKeymap: false,
        heading: { levels: [3] },
      }),
      TextStyle,
      FontSize,
      SizeKeys,
      ListKeys,
      // Its Backspace / Delete handling, without its Tab (ours decides, so Esc then Tab can leave the field).
      ListKeymap.extend({
        addKeyboardShortcuts() {
          const keys = { ...(this.parent?.() ?? {}) };
          delete (keys as Record<string, unknown>).Tab;
          return keys;
        },
      }),
      Placeholder.configure({ placeholder: () => placeholderRef.current }),
    ],
    content: toDoc(value),
    editable: !disabled,
    autofocus: autoFocus ? "end" : false,
    editorProps: { attributes: attributes() },
    onUpdate: ({ editor: e }) => {
      const v = fromDoc(e.getJSON());
      if (v === last.current) return;
      last.current = v;
      change.current(v);
    },
  });

  // A new value from outside (another entry, a reload, a reset): show it.
  useEffect(() => {
    if (!editor || value === last.current) return;
    last.current = value;
    editor.commands.setContent(toDoc(value), { emitUpdate: false });
  }, [editor, value]);
  useEffect(() => {
    editor?.setEditable(!disabled, false);
  }, [editor, disabled]);
  const attrsKey = JSON.stringify([id, className, disabled, aria, testId]);
  useEffect(() => {
    editor?.setOptions({ editorProps: { attributes: attributes() } });
  }, [editor, attrsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`rt-field${disabled ? " disabled" : ""}`} style={{ ["--rt-rows" as string]: String(rows), ...style }} onBlur={onBlur}>
      <EditorContent editor={editor} />
      {editor && !disabled && <FormatBar editor={editor} />}
    </div>
  );
}
