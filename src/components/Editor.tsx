import { useRef, useEffect, useImperativeHandle, forwardRef } from "react";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { vim, Vim } from "@replit/codemirror-vim";
import { minimalSetup } from "codemirror";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { bracketMatching, indentOnInput, syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { searchKeymap } from "@codemirror/search";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { autocompletion, type CompletionContext, completionKeymap, startCompletion, moveCompletionSelection } from "@codemirror/autocomplete";
import { editorSaveRef, saveAndQuitAllRef, ensureExCommands } from "../lib/vim-commands";
import { getCmTheme, type ThemeName } from "../lib/themes";
import { listCollectionFields } from "../lib/tauri-commands";

// Lean editor setup — no folding, no multi-cursor, no drag-drop, no lint
// (basicSetup includes all of those which add unnecessary overhead for a query editor)
const mogyEditorSetup = [
  lineNumbers(),
  highlightActiveLineGutter(),
  history(),
  drawSelection(),
  indentOnInput(),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  bracketMatching(),
  closeBrackets(),
  highlightActiveLine(),
  keymap.of([
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...searchKeymap,
    ...historyKeymap,
  ]),
];

// Hoisted outside component — allocated once, not per completion call
const MONGO_OPERATORS = [
  // Pipeline stages
  { label: "$match", detail: "stage", apply: "$match: {\n      \n    }" },
  { label: "$group", detail: "stage", apply: "$group: {\n      _id: \"$field\",\n      count: { $sum: 1 }\n    }" },
  { label: "$project", detail: "stage", apply: "$project: {\n      field: 1\n    }" },
  { label: "$sort", detail: "stage", apply: "$sort: {\n      field: 1\n    }" },
  { label: "$limit", detail: "stage", apply: "$limit: 20" },
  { label: "$skip", detail: "stage", apply: "$skip: 0" },
  { label: "$unwind", detail: "stage", apply: "$unwind: \"$field\"" },
  { label: "$lookup", detail: "stage", apply: "$lookup: {\n        from: \"collection\",\n        localField: \"field\",\n        foreignField: \"_id\",\n        as: \"result\"\n      }" },
  { label: "$graphLookup", detail: "stage", apply: "$graphLookup: {\n        from: \"collection\",\n        startWith: \"$field\",\n        connectFromField: \"field\",\n        connectToField: \"_id\",\n        as: \"result\"\n      }" },
  { label: "$unionWith", detail: "stage", apply: "$unionWith: \"collection\"" },
  { label: "$addFields", detail: "stage", apply: "$addFields: {\n        newField: \"value\"\n      }" },
  { label: "$set", detail: "stage/update", apply: "$set: {\n        field: \"value\"\n      }" },
  { label: "$unset", detail: "stage/update", apply: "$unset: \"field\"" },
  { label: "$replaceRoot", detail: "stage", apply: "$replaceRoot: { newRoot: \"$field\" }" },
  { label: "$replaceWith", detail: "stage", apply: "$replaceWith: \"$field\"" },
  { label: "$count", detail: "stage/accum", apply: "$count: \"total\"" },
  { label: "$facet", detail: "stage", apply: "$facet: {\n      \n    }" },
  { label: "$bucket", detail: "stage", apply: "$bucket: {\n        groupBy: \"$field\",\n        boundaries: [],\n        default: \"other\"\n      }" },
  { label: "$bucketAuto", detail: "stage", apply: "$bucketAuto: {\n        groupBy: \"$field\",\n        buckets: 5\n      }" },
  { label: "$sortByCount", detail: "stage", apply: "$sortByCount: \"$field\"" },
  { label: "$sample", detail: "stage", apply: "$sample: { size: 10 }" },
  { label: "$out", detail: "stage", apply: "$out: \"collection\"" },
  { label: "$merge", detail: "stage", apply: "$merge: {\n      into: \"collection\"\n    }" },
  // Comparison operators
  { label: "$eq", detail: "comparison", apply: "$eq: " },
  { label: "$ne", detail: "comparison", apply: "$ne: " },
  { label: "$gt", detail: "comparison", apply: "$gt: " },
  { label: "$gte", detail: "comparison", apply: "$gte: " },
  { label: "$lt", detail: "comparison", apply: "$lt: " },
  { label: "$lte", detail: "comparison", apply: "$lte: " },
  { label: "$in", detail: "comparison", apply: "$in: []" },
  { label: "$nin", detail: "comparison", apply: "$nin: []" },
  { label: "$cmp", detail: "comparison", apply: "$cmp: [\"$a\", \"$b\"]" },
  // Logical operators
  { label: "$and", detail: "logical", apply: "$and: [{}]" },
  { label: "$or", detail: "logical", apply: "$or: [{}]" },
  { label: "$not", detail: "logical", apply: "$not: {}" },
  { label: "$nor", detail: "logical", apply: "$nor: [{}]" },
  // Element operators
  { label: "$exists", detail: "element", apply: "$exists: true" },
  { label: "$type", detail: "element", apply: "$type: \"string\"" },
  // Evaluation operators
  { label: "$expr", detail: "evaluation", apply: "$expr: {}" },
  { label: "$regex", detail: "evaluation", apply: "$regex: //" },
  { label: "$text", detail: "evaluation", apply: "$text: { $search: \"\" }" },
  { label: "$where", detail: "evaluation", apply: "$where: \"\"" },
  { label: "$mod", detail: "evaluation", apply: "$mod: [, 0]" },
  { label: "$jsonSchema", detail: "evaluation", apply: "$jsonSchema: {}" },
  // Array query operators
  { label: "$all", detail: "array", apply: "$all: []" },
  { label: "$elemMatch", detail: "array", apply: "$elemMatch: {}" },
  { label: "$size", detail: "array", apply: "$size: " },
  // Aggregation expressions — arithmetic
  { label: "$add", detail: "arithmetic", apply: "$add: [\"$a\", \"$b\"]" },
  { label: "$subtract", detail: "arithmetic", apply: "$subtract: [\"$a\", \"$b\"]" },
  { label: "$multiply", detail: "arithmetic", apply: "$multiply: [\"$a\", \"$b\"]" },
  { label: "$divide", detail: "arithmetic", apply: "$divide: [\"$a\", \"$b\"]" },
  // String expressions
  { label: "$concat", detail: "string", apply: "$concat: [\"$a\", \"$b\"]" },
  { label: "$substr", detail: "string", apply: "$substr: [\"$field\", 0, 5]" },
  { label: "$substrBytes", detail: "string", apply: "$substrBytes: [\"$field\", 0, 5]" },
  { label: "$substrCP", detail: "string", apply: "$substrCP: [\"$field\", 0, 5]" },
  { label: "$toLower", detail: "string", apply: "$toLower: \"$field\"" },
  { label: "$toUpper", detail: "string", apply: "$toUpper: \"$field\"" },
  { label: "$trim", detail: "string", apply: "$trim: { input: \"$field\" }" },
  { label: "$ltrim", detail: "string", apply: "$ltrim: { input: \"$field\" }" },
  { label: "$rtrim", detail: "string", apply: "$rtrim: { input: \"$field\" }" },
  { label: "$split", detail: "string", apply: "$split: [\"$field\", \",\"]" },
  // Array expressions
  { label: "$arrayElemAt", detail: "array expr", apply: "$arrayElemAt: [\"$field\", 0]" },
  { label: "$concatArrays", detail: "array expr", apply: "$concatArrays: [\"$a\", \"$b\"]" },
  { label: "$filter", detail: "array expr", apply: "$filter: {\n        input: \"$field\",\n        as: \"item\",\n        cond: {}\n      }" },
  { label: "$map", detail: "array expr", apply: "$map: {\n        input: \"$field\",\n        as: \"item\",\n        in: \"$$item\"\n      }" },
  { label: "$reduce", detail: "array expr", apply: "$reduce: {\n        input: \"$field\",\n        initialValue: 0,\n        in: {}\n      }" },
  { label: "$slice", detail: "array expr", apply: "$slice: [\"$field\", 5]" },
  // Conditional expressions
  { label: "$cond", detail: "conditional", apply: "$cond: {\n        if: {},\n        then: \"\",\n        else: \"\"\n      }" },
  { label: "$ifNull", detail: "conditional", apply: "$ifNull: [\"$field\", \"default\"]" },
  { label: "$switch", detail: "conditional", apply: "$switch: {\n        branches: [\n          { case: {}, then: \"\" }\n        ],\n        default: \"\"\n      }" },
  // Date expressions
  { label: "$dateToString", detail: "date", apply: "$dateToString: { format: \"%Y-%m-%d\", date: \"$field\" }" },
  { label: "$dateFromString", detail: "date", apply: "$dateFromString: { dateString: \"\" }" },
  { label: "$year", detail: "date", apply: "$year: \"$field\"" },
  { label: "$month", detail: "date", apply: "$month: \"$field\"" },
  { label: "$dayOfMonth", detail: "date", apply: "$dayOfMonth: \"$field\"" },
  { label: "$now", detail: "date", apply: "$now" },
  // Type/conversion expressions
  { label: "$toString", detail: "type", apply: "$toString: \"$field\"" },
  { label: "$toInt", detail: "type", apply: "$toInt: \"$field\"" },
  { label: "$toDouble", detail: "type", apply: "$toDouble: \"$field\"" },
  { label: "$toBool", detail: "type", apply: "$toBool: \"$field\"" },
  { label: "$convert", detail: "type", apply: "$convert: { input: \"$field\", to: \"string\" }" },
  // Accumulators (used in $group)
  { label: "$sum", detail: "accumulator", apply: "$sum: 1" },
  { label: "$avg", detail: "accumulator", apply: "$avg: \"$field\"" },
  { label: "$min", detail: "accumulator", apply: "$min: \"$field\"" },
  { label: "$max", detail: "accumulator", apply: "$max: \"$field\"" },
  { label: "$push", detail: "accumulator/update", apply: "$push: \"$field\"" },
  { label: "$addToSet", detail: "accumulator/update", apply: "$addToSet: \"$field\"" },
  { label: "$first", detail: "accumulator", apply: "$first: \"$field\"" },
  { label: "$last", detail: "accumulator", apply: "$last: \"$field\"" },
  // Update operators
  { label: "$inc", detail: "update", apply: "$inc: { field: 1 }" },
  { label: "$mul", detail: "update", apply: "$mul: { field: 2 }" },
  { label: "$rename", detail: "update", apply: "$rename: { oldField: \"newField\" }" },
  { label: "$pop", detail: "update", apply: "$pop: { field: 1 }" },
  { label: "$pull", detail: "update", apply: "$pull: { field: \"value\" }" },
  { label: "$pullAll", detail: "update", apply: "$pullAll: { field: [] }" },
  { label: "$each", detail: "update modifier", apply: "$each: []" },
  { label: "$position", detail: "update modifier", apply: "$position: 0" },
  { label: "$bit", detail: "update", apply: "$bit: { field: { and: 0 } }" },
  // Special
  { label: "$hint", detail: "special", apply: "$hint: {}" },
  { label: "$comment", detail: "special", apply: "$comment: \"\"" },
  { label: "$meta", detail: "special", apply: "$meta: \"textScore\"" },
];

const MONGO_METHODS = [
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
  { label: "distinct", type: "function", detail: "(field, query?)", apply: "distinct(\"\")" },
  { label: "findOneAndUpdate", type: "function", detail: "(filter, update)", apply: "findOneAndUpdate({}, {$set:{}})" },
  { label: "findOneAndDelete", type: "function", detail: "(query)", apply: "findOneAndDelete({})" },
  { label: "findOneAndReplace", type: "function", detail: "(filter, doc)", apply: "findOneAndReplace({}, {})" },
  { label: "estimatedDocumentCount", type: "function", detail: "()", apply: "estimatedDocumentCount()" },
  { label: "createIndex", type: "function", detail: "(keys)", apply: "createIndex({})" },
  { label: "dropIndex", type: "function", detail: "(name)", apply: "dropIndex(\"\")" },
  { label: "drop", type: "function", detail: "()", apply: "drop()" },
];

const MONGO_TYPES = [
  { label: "ObjectId", detail: "(id?)", apply: "ObjectId(\"\")" },
  { label: "ISODate", detail: "(date?)", apply: "ISODate(\"\")" },
  { label: "NumberDecimal", detail: "(value)", apply: "NumberDecimal(\"\")" },
];

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
  const selectedDbRef = useRef(selectedDb);
  selectedDbRef.current = selectedDb;

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
        lightweight ? minimalSetup : [mogyEditorSetup, javascript()]
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

      // Check for $ operators — show all MongoDB operators
      const aggregateStageMatch = lineText.match(/\$(\w*)$/);
      if (aggregateStageMatch) {
        const incomplete = aggregateStageMatch[1] || "";
        const filterStr = incomplete ? "$" + incomplete.toLowerCase() : "$";
        const filtered = MONGO_OPERATORS.filter(s => s.label.toLowerCase().startsWith(filterStr));
        return {
          from: context.pos - incomplete.length - 1,
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
        const filter = incomplete.toLowerCase();
        const filtered = MONGO_METHODS.filter(m => m.label.startsWith(filter));

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
        const filtered = MONGO_TYPES.filter(t => t.label.toLowerCase().startsWith(filter));
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
      const currentDb = selectedDbRef.current;
      const needsFetch = detectedCollectionRef.current !== collectionName || fieldsCacheRef.current.length === 0;
      if (needsFetch && currentDb) {
        detectedCollectionRef.current = collectionName;
        fieldsCacheRef.current = [];
        pendingFetchRef.current = true;
        listCollectionFields(currentDb, collectionName)
          .then((fields) => {
            fieldsCacheRef.current = fields;
            pendingFetchRef.current = false;
            // Re-open autocomplete with real fields
            const view = viewRef.current;
            if (view) startCompletion(view);
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

      if (!word.startsWith("$")) {
        // Show loading placeholder while waiting for fields
        if (pendingFetchRef.current) {
          return {
            from: beforePos - word.length,
            options: [{ label: "loading fields...", type: "text", apply: "" }],
            validFor: /^[\w.]*$/,
          };
        }

        if (fieldsCacheRef.current.length === 0) return null;

        const filter = word.toLowerCase();
        const allFields = ["_id", ...fieldsCacheRef.current.filter(f => f !== "_id")];
        const filtered = filter.length > 0
          ? allFields.filter(f => f.toLowerCase().startsWith(filter))
          : allFields;
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
        syntaxCompartment.current.of(lightweight ? minimalSetup : [mogyEditorSetup, javascript()]),
        themeCompartment.current.of(getCmTheme(theme)),
        autocompletion({ override: [mongoCompletion], defaultKeymap: true, activateOnTyping: true }),
        // Ctrl+N: navigate down if popup open, otherwise open autocomplete
        // Ctrl+P: navigate up (only when popup open)
        keymap.of([
          {
            key: "Ctrl-n",
            run: (view) => moveCompletionSelection(true)(view) || startCompletion(view),
          },
          {
            key: "Ctrl-p",
            run: moveCompletionSelection(false),
          },
          ...completionKeymap.filter((b: any) => b.key !== "ArrowUp" && b.key !== "ArrowDown"),
        ]),
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
