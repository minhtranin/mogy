import { useRef, useEffect, useImperativeHandle, forwardRef } from "react";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { vim, Vim } from "@replit/codemirror-vim";
import { basicSetup, minimalSetup } from "codemirror";
import { autocompletion, type CompletionContext, completionKeymap } from "@codemirror/autocomplete";
import { editorSaveRef, saveAndQuitAllRef, ensureExCommands } from "../lib/vim-commands";
import { getCmTheme, type ThemeName } from "../lib/themes";
import { listCollectionFields } from "../lib/tauri-commands";

interface EditorProps {
  focused: boolean;
  lightweight: boolean;
  initialContent?: string;
  theme?: ThemeName;
  onFocus: () => void;
  onSave?: () => void;
  onChange?: () => void;
  onSaveAndQuit?: () => void;
  collections?: string[];
  selectedDb?: string | null;
}

export interface EditorHandle {
  focus: () => void;
  blur: () => void;
  getQueryText: () => string;
  getText: () => string;
  setText: (text: string) => void;
  insertAtCursor: (text: string) => void;
  setTheme: (theme: ThemeName) => void;
  getCursorPosition: () => number;
}

export default forwardRef<EditorHandle, EditorProps>(function Editor(
  { focused, lightweight, initialContent, theme = "mocha", onFocus, onSave, onChange, onSaveAndQuit, collections = [], selectedDb },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const themeCompartment = useRef(new Compartment());
  const syntaxCompartment = useRef(new Compartment());
  const lightweightRef = useRef(lightweight);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSaveAndQuitRef = useRef(onSaveAndQuit);
  onSaveAndQuitRef.current = onSaveAndQuit;
  const collectionsRef = useRef(collections);
  collectionsRef.current = collections;

  // Track detected collection for field autocomplete
  const detectedCollectionRef = useRef<string>("");
  // Cache for collection fields
  const fieldsCacheRef = useRef<string[]>([]);
  // Track if we're waiting for fetch
  const pendingFetchRef = useRef(false);

  useImperativeHandle(ref, () => ({
    focus() {
      viewRef.current?.focus();
    },
    blur() {
      viewRef.current?.contentDOM.blur();
    },
    getQueryText(): string {
      const view = viewRef.current;
      if (!view) return "";
      const selection = view.state.selection.main;
      const raw =
        selection.from !== selection.to
          ? view.state.sliceDoc(selection.from, selection.to)
          : view.state.doc.toString();
      return raw
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("//"))
        .join("\n");
    },
    getText(): string {
      return viewRef.current?.state.doc.toString() ?? "";
    },
    setText(text: string) {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
      });
    },
    insertAtCursor(text: string) {
      const view = viewRef.current;
      if (!view) return;
      const cursor = view.state.selection.main.head;
      const line = view.state.doc.lineAt(cursor);
      const prefix = line.text.trim() ? "\n" : "";
      const insert = prefix + text;
      view.dispatch({
        changes: { from: cursor, insert },
        selection: { anchor: cursor + insert.length },
      });
    },
    setTheme(theme: ThemeName) {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: themeCompartment.current.reconfigure(getCmTheme(theme)),
      });
    },
    getCursorPosition(): number {
      return viewRef.current?.state.selection.main.head ?? 0;
    },
  }));

  // Set editor-level save callback
  useEffect(() => {
    editorSaveRef.current = () => {
      onSaveRef.current?.();
    };
    saveAndQuitAllRef.current = () => {
      onSaveAndQuitRef.current?.();
    };
    return () => {
      editorSaveRef.current = null;
      saveAndQuitAllRef.current = null;
    };
  }, []);

  // Sync lightweight prop → reconfigure syntax compartment
  useEffect(() => {
    const view = viewRef.current;
    if (!view || lightweightRef.current === lightweight) return;
    lightweightRef.current = lightweight;
    const cursor = view.state.selection.main.head;
    view.dispatch({
      effects: syntaxCompartment.current.reconfigure(
        lightweight ? minimalSetup : [basicSetup, javascript()]
      ),
      selection: { anchor: cursor },
    });
    requestAnimationFrame(() => view.focus());
  }, [lightweight]);

  useEffect(() => {
    if (!containerRef.current) return;

    ensureExCommands();

    // Custom completion source that uses ref for collections
    const mongoCompletion = (context: CompletionContext) => {
      const line = context.state.doc.lineAt(context.pos);
      const lineText = line.text.slice(0, context.pos - line.from);
      const fullDoc = context.state.doc.toString();

      // Check for $ inside aggregate pipeline - show aggregate stages
      // Check for $ inside aggregate pipeline - show aggregate stages
      const aggregateStageMatch = lineText.match(/\$(\w*)$/);
      if (aggregateStageMatch) {
        const incomplete = aggregateStageMatch[1] || "";
        const stages = [
          { label: "$match", apply: "$match: {\n      \n    }" },
          { label: "$group", apply: "$group: {\n      _id: \"$field\",\n      count: { $sum: 1 }\n    }" },
          { label: "$project", apply: "$project: {\n      field: 1\n    }" },
          { label: "$sort", apply: "$sort: {\n      field: 1\n    }" },
          { label: "$limit", apply: "$limit: 20" },
          { label: "$skip", apply: "$skip: 0" },
          { label: "$unwind", apply: "$unwind: \"$field\"" },
          { label: "$lookup", apply: "$lookup: {\n        from: \"collection\",\n        localField: \"field\",\n        foreignField: \"_id\",\n        as: \"result\"\n      }" },
          { label: "$addFields", apply: "$addFields: {\n        newField: \"value\"\n      }" },
          { label: "$set", apply: "$set: {\n        newField: \"value\"\n      }" },
          { label: "$count", apply: "$count: \"total\"" },
          { label: "$facet", apply: "$facet: {\n      \n    }" },
          { label: "$bucket", apply: "$bucket: {\n        groupBy: \"$field\",\n        boundaries: [],\n        default: \"other\"\n      }" },
          { label: "$out", apply: "$out: \"collection\"" },
          { label: "$merge", apply: "$merge: {\n      into: \"collection\"\n    }" },
          { label: "$addToSet", apply: "$addToSet: \"$field\"" },
        ];
        const filterStr = incomplete ? "$" + incomplete.toLowerCase() : "$";
        const filtered = stages.filter(s => s.label.toLowerCase().startsWith(filterStr));
        return {
          from: context.pos - incomplete.length - 1, // -1 to exclude the $ from replacement
          options: filtered,
          validFor: /^\$.*/,
        };
      }

      // MongoDB methods after db.collection.
      const collectionMatch = lineText.match(/db\.(\w*)$/);
      if (collectionMatch) {
        const incomplete = collectionMatch[1] || "";
        const filter = incomplete.toLowerCase();
        const colls = collectionsRef.current
          .filter((name) => name.toLowerCase().startsWith(filter));
        return {
          from: context.pos - incomplete.length,
          options: colls.map((name) => ({
            label: name,
            type: "property",
            apply: name,
          })),
          validFor: /^\w*$/,
        };
      }

      // Check for db.collection.method
      const methodMatch = lineText.match(/db\.\w+\.(\w*)$/);
      if (methodMatch) {
        const incomplete = methodMatch[1] || "";
        const methods = [
          { label: "find", type: "function", detail: "(query)", apply: "find({})" },
          { label: "findOne", type: "function", detail: "(query)", apply: "findOne({})" },
          { label: "insertOne", type: "function", detail: "(doc)", apply: "insertOne({})" },
          { label: "insertMany", type: "function", detail: "([docs])", apply: "insertMany([{}])" },
          { label: "updateOne", type: "function", detail: "(filter, update)", apply: "updateOne({}, {$set:{}})" },
          { label: "updateMany", type: "function", detail: "(filter, update)", apply: "updateMany({}, {$set:{}})" },
          { label: "deleteOne", type: "function", detail: "(query)", apply: "deleteOne({})" },
          { label: "deleteMany", type: "function", detail: "(query)", apply: "deleteMany({})" },
          { label: "replaceOne", type: "function", detail: "(filter, doc)", apply: "replaceOne({}, {})" },
          { label: "count", type: "function", detail: "(query?)", apply: "count({})" },
          { label: "aggregate", type: "function", detail: "([pipeline])", apply: "aggregate([\n    {\n      $match: {\n        \n      }\n    }\n])" },
          { label: "$match", type: "function", detail: "$match", apply: "{\n    $match: {\n      \n    }\n}" },
          { label: "$group", type: "function", detail: "$group", apply: "{\n    $group: {\n      _id: \"$field\",\n      count: { $sum: 1 }\n    }\n}" },
          { label: "$project", type: "function", detail: "$project", apply: "{\n    $project: {\n      field: 1\n    }\n}" },
          { label: "$sort", type: "function", detail: "$sort", apply: "{\n    $sort: {\n      field: 1\n    }\n}" },
          { label: "$limit", type: "function", detail: "$limit", apply: "{ $limit: 20 }" },
          { label: "$skip", type: "function", detail: "$skip", apply: "{ $skip: 0 }" },
          { label: "$unwind", type: "function", detail: "$unwind", apply: "{\n    $unwind: \"$field\"\n}" },
          { label: "$lookup", type: "function", detail: "$lookup", apply: "{\n    $lookup: {\n        from: \"collection\",\n        localField: \"field\",\n        foreignField: \"_id\",\n        as: \"result\"\n    }\n}" },
          { label: "$addToSet", type: "function", detail: "$addToSet", apply: "{ $addToSet: \"$field\" }" },
          { label: "distinct", type: "function", detail: "(field, query?)", apply: "distinct(\"\")" },
          { label: "findOneAndUpdate", type: "function", detail: "(filter, update)", apply: "findOneAndUpdate({}, {$set:{}})" },
          { label: "findOneAndDelete", type: "function", detail: "(query)", apply: "findOneAndDelete({})" },
          { label: "findOneAndReplace", type: "function", detail: "(filter, doc)", apply: "findOneAndReplace({}, {})" },
          { label: "estimatedDocumentCount", type: "function", detail: "()", apply: "estimatedDocumentCount()" },
          { label: "createIndex", type: "function", detail: "(keys)", apply: "createIndex({})" },
          { label: "dropIndex", type: "function", detail: "(name)", apply: "dropIndex(\"\")" },
          { label: "drop", type: "function", detail: "()", apply: "drop()" },
        ];

        const filter = incomplete.toLowerCase();
        const filtered = methods.filter(m => m.label.startsWith(filter));

        return {
          from: context.pos - incomplete.length,
          options: filtered.map(m => ({
            label: m.label,
            type: m.type,
            detail: m.detail,
            apply: m.apply,
          })),
          validFor: /^\w*$/,
        };
      }

      // MongoDB type constructors: ObjectId, ISODate, NumberDecimal, etc.
      const typeMatch = context.matchBefore(/[A-Z]\w*/);
      if (typeMatch && typeMatch.text.length > 0) {
        const filter = typeMatch.text.toLowerCase();
        const types = [
          { label: "ObjectId", detail: "(id?)", apply: "ObjectId(\"\")" },
          { label: "ISODate", detail: "(date?)", apply: "ISODate(\"\")" },
          { label: "NumberDecimal", detail: "(value)", apply: "NumberDecimal(\"\")" },
        ];
        const filtered = types.filter(t => t.label.toLowerCase().startsWith(filter));
        if (filtered.length === 0) return null;
        return {
          from: typeMatch.from,
          options: filtered.map(t => ({ label: t.label, type: "type", detail: t.detail, apply: t.apply })),
          validFor: /^[A-Z]\w*$/,
        };
      }

      // Field autocomplete: inside { } query context
      const beforePos = context.pos;
      // Limit scan to last 500 chars for performance (queries don't exceed this)
      const scanStart = Math.max(0, beforePos - 500);
      const scanText = fullDoc.slice(scanStart, beforePos);

      // Count unclosed braces by scanning backwards (limit scan range)
      let openBraces = 0;
      let closeBraces = 0;
      for (let i = scanText.length - 1; i >= 0; i--) {
        const ch = scanText[i];
        if (ch === '}') closeBraces++;
        else if (ch === '{') {
          if (closeBraces > 0) closeBraces--;
          else openBraces++;
        }
      }
      if (openBraces === 0) return null;

      // Find last db.collection BEFORE cursor position using lastIndexOf (faster than regex)
      const lastDbPos = scanText.lastIndexOf("db.");
      if (lastDbPos === -1) return null;

      const afterDb = scanText.slice(lastDbPos + 3, beforePos);
      const fieldCollectionMatch = afterDb.match(/^(\w+)/);
      if (!fieldCollectionMatch || !fieldCollectionMatch[1]) return null;
      const collectionName = fieldCollectionMatch[1];

      // Check if we need to fetch for this collection
      const needsFetch = detectedCollectionRef.current !== collectionName || fieldsCacheRef.current.length === 0;
      if (needsFetch && selectedDb) {
        detectedCollectionRef.current = collectionName;
        fieldsCacheRef.current = []; // Clear cache
        pendingFetchRef.current = true;
        // Fire-and-forget fetch
        listCollectionFields(selectedDb, collectionName)
          .then((fields) => {
            fieldsCacheRef.current = fields;
            pendingFetchRef.current = false;
          })
          .catch(() => {
            fieldsCacheRef.current = [];
            pendingFetchRef.current = false;
          });
      }

      // Get word before cursor
      const wordBeforeRegex = /[\w.]+$/;
      const wordMatch = scanText.match(wordBeforeRegex);
      const word = wordMatch ? wordMatch[0] : "";

      if (word && !word.startsWith("$") && word.length > 0) {
        const filter = word.toLowerCase();
        // Use cached fields, or _id if waiting
        const fields = fieldsCacheRef.current.length > 0 && !pendingFetchRef.current
          ? fieldsCacheRef.current
          : ["_id"];
        const allFields = fields.length > 0 ? ["_id", ...fields] : ["_id"];
        const filtered = allFields.filter(f => f.toLowerCase().startsWith(filter));
        if (filtered.length > 0) {
          return {
            from: beforePos - word.length,
            options: filtered.map(f => ({
              label: f,
              type: "property",
              apply: f,
            })),
            validFor: /^[\w.]*$/,
          };
        }
      }

      // $field references in aggregation (inside quotes after $)
      const dollarFieldMatch = lineText.match(/"(\$\w*)$/);
      if (dollarFieldMatch && dollarFieldMatch[1]) {
        const incomplete = dollarFieldMatch[1];
        const fields = fieldsCacheRef.current.map(f => "$" + f);
        const filter = incomplete.toLowerCase();
        const filtered = fields.filter(f => f.toLowerCase().startsWith(filter));
        if (filtered.length > 0) {
          return {
            from: context.pos - incomplete.length,
            options: filtered.map(f => ({
              label: f,
              type: "property",
              apply: f + "\"",
            })),
            validFor: /^\$.*/,
          };
        }
      }

      return null;
    };

    const state = EditorState.create({
      doc: initialContent || "// Ctrl+Enter to run query\n\ndb.collection.find({})\n",
      extensions: [
        vim(),
        syntaxCompartment.current.of(lightweight ? minimalSetup : [basicSetup, javascript()]),
        themeCompartment.current.of(getCmTheme(theme)),
        autocompletion({ override: [mongoCompletion], defaultKeymap: true, activateOnTyping: true }),
        // Add Ctrl+N/P as additional keys for navigation
        keymap.of(completionKeymap.map((binding: any) => {
          // Replace ArrowUp with Ctrl-p
          if (binding.key === "ArrowUp") {
            return { ...binding, key: "Ctrl-p" };
          }
          // Replace ArrowDown with Ctrl-n
          if (binding.key === "ArrowDown") {
            return { ...binding, key: "Ctrl-n" };
          }
          return binding;
        })),
        EditorView.updateListener.of((update) => {
          if (update.focusChanged && update.view.hasFocus) {
            onFocus();
          }
          if (update.docChanged) {
            onChangeRef.current?.();
          }
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    Vim.map("jk", "<Esc>", "insert");

    return () => {
      view.destroy();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (focused && viewRef.current) {
      viewRef.current.focus();
    }
  }, [focused]);

  return (
    <div
      ref={containerRef}
      className={`h-full w-full overflow-hidden border ${
        focused ? "border-[var(--accent)]" : "border-transparent"
      } ${lightweight ? "editor-lightweight" : ""}`}
      onClick={onFocus}
    />
  );
});
