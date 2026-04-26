import React, { useCallback, useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import TextStyle from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import FontFamily from '@tiptap/extension-font-family';

// Extend TextStyle to support custom fontSize attribute (Tiptap doesn't ship with this OOTB)
const TextStyleWithFontSize = TextStyle.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      fontSize: {
        default: null,
        parseHTML: (element) => element.style.fontSize?.replace(/['"]+/g, '') || null,
        renderHTML: (attributes) => {
          if (!attributes.fontSize) return {};
          return { style: `font-size: ${attributes.fontSize}` };
        }
      }
    };
  }
});
import Underline from '@tiptap/extension-underline';
import Superscript from '@tiptap/extension-superscript';
import Subscript from '@tiptap/extension-subscript';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import Highlight from '@tiptap/extension-highlight';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import RichTextToolbar from './RichTextToolbar';

/**
 * עורך טקסט עשיר מבוסס Tiptap, עם תמיכה מלאה ב-RTL/LTR ובכל יכולות העיצוב.
 * כל ה-extensions מוגדרים פעם אחת ברשימה אחת מסודרת.
 */
export default function RichTextEditor({ value, onChange, placeholder = 'הקלד כאן...', minHeight = 200 }) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] }
      }),
      Underline,
      Superscript,
      Subscript,
      TextStyleWithFontSize,
      Color,
      FontFamily,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({
        types: ['heading', 'paragraph'],
        alignments: ['right', 'center', 'left', 'justify']
      }),
      Link.configure({ openOnClick: false, autolink: true }),
      Image.configure({ inline: false, allowBase64: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      TaskList,
      TaskItem.configure({ nested: true })
    ],
    content: value || '',
    onUpdate: ({ editor: ed }) => {
      onChange?.(ed.getHTML());
    },
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none focus:outline-none p-3',
        style: `min-height: ${minHeight}px; direction: rtl;`,
        dir: 'auto'
      }
    }
  });

  // Sync external value changes (e.g., when loading data from server) without breaking caret
  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    if (value !== undefined && value !== current) {
      editor.commands.setContent(value || '', false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor]);

  if (!editor) {
    return (
      <div className="border rounded-lg p-3 bg-gray-50 text-gray-400 text-center">
        טוען עורך...
      </div>
    );
  }

  return (
    <div className="rich-text-editor border rounded-lg bg-white overflow-hidden">
      <RichTextToolbar editor={editor} />
      <div className="border-t">
        <EditorContent editor={editor} placeholder={placeholder} />
      </div>
      {/* Editor styling */}
      <style>{`
        .rich-text-editor .ProseMirror { outline: none; }
        .rich-text-editor .ProseMirror p { margin: 0.5em 0; }
        .rich-text-editor .ProseMirror h1 { font-size: 1.8em; font-weight: 700; margin: 0.5em 0; }
        .rich-text-editor .ProseMirror h2 { font-size: 1.5em; font-weight: 700; margin: 0.5em 0; }
        .rich-text-editor .ProseMirror h3 { font-size: 1.3em; font-weight: 600; margin: 0.5em 0; }
        .rich-text-editor .ProseMirror h4 { font-size: 1.15em; font-weight: 600; margin: 0.5em 0; }
        .rich-text-editor .ProseMirror h5 { font-size: 1.05em; font-weight: 600; margin: 0.5em 0; }
        .rich-text-editor .ProseMirror h6 { font-size: 1em; font-weight: 600; margin: 0.5em 0; }
        .rich-text-editor .ProseMirror ul { list-style: disc; padding-right: 1.5em; padding-left: 0; }
        .rich-text-editor .ProseMirror ol { list-style: decimal; padding-right: 1.5em; padding-left: 0; }
        .rich-text-editor .ProseMirror blockquote { border-right: 3px solid #ccc; border-left: none; padding-right: 1em; padding-left: 0; color: #666; font-style: italic; }
        .rich-text-editor .ProseMirror table { border-collapse: collapse; table-layout: fixed; width: 100%; margin: 0.5em 0; }
        .rich-text-editor .ProseMirror table td, .rich-text-editor .ProseMirror table th { border: 1px solid #ccc; padding: 6px 8px; min-width: 1em; vertical-align: top; }
        .rich-text-editor .ProseMirror table th { background: #f3f4f6; font-weight: 600; }
        .rich-text-editor .ProseMirror img { max-width: 100%; height: auto; border-radius: 4px; }
        .rich-text-editor .ProseMirror code { background: #f3f4f6; padding: 1px 4px; border-radius: 3px; font-family: monospace; }
        .rich-text-editor .ProseMirror pre { background: #1f2937; color: #f3f4f6; padding: 0.75em; border-radius: 4px; overflow-x: auto; }
        .rich-text-editor .ProseMirror pre code { background: transparent; color: inherit; padding: 0; }
        .rich-text-editor .ProseMirror a { color: #2563eb; text-decoration: underline; }
        .rich-text-editor .ProseMirror hr { border: 0; border-top: 1px solid #e5e7eb; margin: 1em 0; }
        .rich-text-editor .ProseMirror [data-text-align="right"] { text-align: right; }
        .rich-text-editor .ProseMirror [data-text-align="center"] { text-align: center; }
        .rich-text-editor .ProseMirror [data-text-align="left"] { text-align: left; }
        .rich-text-editor .ProseMirror [data-text-align="justify"] { text-align: justify; }
      `}</style>
    </div>
  );
}