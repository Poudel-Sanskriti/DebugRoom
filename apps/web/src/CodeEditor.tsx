import { useEffect, useRef } from "react";
import { Compartment, EditorState } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { tags } from "@lezer/highlight";
import { cpp } from "@codemirror/lang-cpp";
import { python } from "@codemirror/lang-python";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";

type Props = {
  value: string;
  onChange: (value: string) => void;
  activeLine?: number;
  readOnly?: boolean;
  language?: "python" | "cpp";
};
export default function CodeEditor({
  value,
  onChange,
  activeLine,
  readOnly = false,
  language = "python",
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const changeHandler = useRef(onChange);
  const lineHighlight = useRef(new Compartment());
  const configuration = useRef(new Compartment());
  const syncing = useRef(false);
  changeHandler.current = onChange;

  useEffect(() => {
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          configuration.current.of([
            language === "python" ? python() : cpp(),
            EditorState.readOnly.of(readOnly),
            EditorView.editable.of(!readOnly),
            EditorView.contentAttributes.of({
              "aria-label": readOnly ? "Run source" : "Program code",
            }),
          ]),
          syntaxHighlighting(
            HighlightStyle.define([
              { tag: tags.keyword, color: "#c4a1ff" },
              { tag: tags.definition(tags.variableName), color: "#9bbdff" },
              { tag: tags.number, color: "#edc285" },
              { tag: tags.string, color: "#a6d7b0" },
              { tag: tags.comment, color: "#8b9ab1" },
            ]),
          ),
          placeholder("# Paste your Python code here"),
          lineHighlight.current.of([]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !syncing.current)
              changeHandler.current(update.state.doc.toString());
          }),
          EditorView.theme(
            {
              "&": {
                height: "100%",
                color: "#dce5f5",
                backgroundColor: "#121c2b",
              },
              ".cm-scroller": {
                fontFamily: '"SFMono-Regular", Consolas, monospace',
                fontSize: "15px",
                lineHeight: "1.9",
                overflow: "auto",
              },
              ".cm-content": { padding: "24px 0", caretColor: "#a7c2ff" },
              ".cm-gutters": {
                backgroundColor: "#121c2b",
                color: "#74849c",
                border: "none",
                paddingRight: "16px",
              },
              ".cm-line": { paddingLeft: "12px" },
              ".cm-activeLineGutter": { backgroundColor: "transparent" },
              ".cm-cursor": { borderLeftColor: "#a7c2ff" },
              ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
                background: "#354b6f !important",
              },
              ".cm-placeholder": { color: "#8493aa" },
              ".cm-trace-line": {
                backgroundColor: "#253c60",
                boxShadow: "inset 3px 0 #8eafff",
              },
            },
            { dark: true },
          ),
        ],
      }),
    });
    editor.current = view;
    return () => {
      view.destroy();
      editor.current = null;
    };
    // Mount the editor once; the effects below synchronize changing props.
  }, []);

  useEffect(() => {
    const view = editor.current;
    if (view && view.state.doc.toString() !== value) {
      syncing.current = true;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
      syncing.current = false;
    }
  }, [value]);
  useEffect(() => {
    editor.current?.dispatch({
      effects: configuration.current.reconfigure([
        language === "python" ? python() : cpp(),
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
        EditorView.contentAttributes.of({
          "aria-label": readOnly ? "Run source" : "Program code",
        }),
      ]),
    });
  }, [readOnly, language]);
  useEffect(() => {
    const view = editor.current;
    if (!view) return;
    const validLine =
      activeLine && activeLine > 0 && activeLine <= view.state.doc.lines
        ? activeLine
        : undefined;
    const decorations = validLine
      ? Decoration.set([
          Decoration.line({ class: "cm-trace-line" }).range(
            view.state.doc.line(validLine).from,
          ),
        ])
      : Decoration.none;
    view.dispatch({
      effects: lineHighlight.current.reconfigure(
        EditorView.decorations.of(decorations),
      ),
    });
    if (validLine)
      view.dispatch({
        effects: EditorView.scrollIntoView(
          view.state.doc.line(validLine).from,
          { y: "nearest" },
        ),
      });
  }, [activeLine, value]);
  return <div className="code-editor" ref={host} />;
}
