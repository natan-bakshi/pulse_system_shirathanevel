import React, { useCallback, useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  AlignRight, AlignCenter, AlignLeft, AlignJustify,
  List, ListOrdered, ListChecks,
  Quote, Code, Code2, Minus,
  Undo, Redo, Eraser,
  Link as LinkIcon, Image as ImageIcon, Table as TableIcon,
  Superscript as SupIcon, Subscript as SubIcon,
  Highlighter, Palette, Type
} from 'lucide-react';
import ColorPalettePopover from './ColorPalettePopover';

const FONT_FAMILIES = [
  { label: 'ברירת מחדל', value: '' },
  { label: 'Assistant', value: 'Assistant, sans-serif' },
  { label: 'Heebo', value: 'Heebo, sans-serif' },
  { label: 'Rubik', value: 'Rubik, sans-serif' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Times New Roman', value: '"Times New Roman", serif' },
  { label: 'Courier New', value: '"Courier New", monospace' },
  { label: 'Segoe UI', value: '"Segoe UI", sans-serif' },
  { label: 'Tahoma', value: 'Tahoma, sans-serif' },
  { label: 'Verdana', value: 'Verdana, sans-serif' }
];

const FONT_SIZES = [
  { label: '8', value: '8px' },
  { label: '10', value: '10px' },
  { label: '12', value: '12px' },
  { label: '14', value: '14px' },
  { label: '16', value: '16px' },
  { label: '18', value: '18px' },
  { label: '20', value: '20px' },
  { label: '24', value: '24px' },
  { label: '28', value: '28px' },
  { label: '32', value: '32px' },
  { label: '36', value: '36px' },
  { label: '48', value: '48px' },
  { label: '60', value: '60px' },
  { label: '72', value: '72px' }
];

function ToolbarButton({ onClick, active, disabled, tooltip, children }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant={active ? 'default' : 'ghost'}
            size="sm"
            onClick={onClick}
            disabled={disabled}
            className="h-8 w-8 p-0"
          >
            {children}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function Divider() {
  return <div className="w-px h-6 bg-gray-300 mx-1" />;
}

export default function RichTextToolbar({ editor }) {
  const [fontSize, setFontSize] = useState('');
  const [fontFamily, setFontFamily] = useState('');

  // NOTE: callbacks must be declared BEFORE any conditional return to keep hook order stable.
  const setLink = useCallback(() => {
    if (!editor) return;
    const previousUrl = editor.getAttributes('link').href;
    const url = window.prompt('כתובת הקישור:', previousUrl || 'https://');
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }, [editor]);

  const insertImage = useCallback(() => {
    if (!editor) return;
    const url = window.prompt('כתובת תמונה (URL):');
    if (url) editor.chain().focus().setImage({ src: url }).run();
  }, [editor]);

  const insertTable = useCallback(() => {
    if (!editor) return;
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  }, [editor]);

  if (!editor) return null;

  const handleFontFamily = (val) => {
    setFontFamily(val);
    if (val && val !== '__default__') editor.chain().focus().setFontFamily(val).run();
    else editor.chain().focus().unsetFontFamily().run();
  };

  const handleFontSize = (val) => {
    setFontSize(val);
    if (val && val !== '__default_size__') {
      editor.chain().focus().setMark('textStyle', { fontSize: val }).run();
    } else {
      editor.chain().focus().setMark('textStyle', { fontSize: null }).run();
    }
  };

  const setDirection = (dir) => {
    // Apply dir attribute to current block via DOM-level manipulation isn't trivial in tiptap;
    // we use TextAlign + body dir to simulate directional alignment.
    if (dir === 'rtl') editor.chain().focus().setTextAlign('right').run();
    else editor.chain().focus().setTextAlign('left').run();
  };

  return (
    <div className="flex flex-wrap items-center gap-1 p-2 bg-gray-50 border-b" dir="rtl">
      {/* Undo / Redo / Clear formatting */}
      <ToolbarButton tooltip="בטל (Ctrl+Z)" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}>
        <Undo className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton tooltip="חזור (Ctrl+Y)" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}>
        <Redo className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton tooltip="נקה עיצוב" onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}>
        <Eraser className="h-4 w-4" />
      </ToolbarButton>
      <Divider />

      {/* Headings + Paragraph */}
      <Select value={
        editor.isActive('heading', { level: 1 }) ? 'h1' :
        editor.isActive('heading', { level: 2 }) ? 'h2' :
        editor.isActive('heading', { level: 3 }) ? 'h3' :
        editor.isActive('heading', { level: 4 }) ? 'h4' :
        editor.isActive('heading', { level: 5 }) ? 'h5' :
        editor.isActive('heading', { level: 6 }) ? 'h6' : 'p'
      } onValueChange={(v) => {
        if (v === 'p') editor.chain().focus().setParagraph().run();
        else editor.chain().focus().toggleHeading({ level: parseInt(v.replace('h', ''), 10) }).run();
      }}>
        <SelectTrigger className="h-8 w-28 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="p">פסקה</SelectItem>
          <SelectItem value="h1">כותרת 1</SelectItem>
          <SelectItem value="h2">כותרת 2</SelectItem>
          <SelectItem value="h3">כותרת 3</SelectItem>
          <SelectItem value="h4">כותרת 4</SelectItem>
          <SelectItem value="h5">כותרת 5</SelectItem>
          <SelectItem value="h6">כותרת 6</SelectItem>
        </SelectContent>
      </Select>

      {/* Font family */}
      <Select value={fontFamily || '__default__'} onValueChange={handleFontFamily}>
        <SelectTrigger className="h-8 w-28 text-xs">
          <SelectValue placeholder="גופן" />
        </SelectTrigger>
        <SelectContent>
          {FONT_FAMILIES.map(f => (
            <SelectItem key={f.value || '__default__'} value={f.value || '__default__'}>
              {f.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Font size */}
      <Select value={fontSize || '__default_size__'} onValueChange={handleFontSize}>
        <SelectTrigger className="h-8 w-20 text-xs">
          <SelectValue placeholder="גודל" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__default_size__">ברירת מחדל</SelectItem>
          {FONT_SIZES.map(s => (
            <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Divider />

      {/* Bold / Italic / Underline / Strike */}
      <ToolbarButton tooltip="מודגש (Ctrl+B)" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton tooltip="נטוי (Ctrl+I)" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton tooltip="קו תחתון (Ctrl+U)" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <UnderlineIcon className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton tooltip="קו חוצה" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}>
        <Strikethrough className="h-4 w-4" />
      </ToolbarButton>
      <Divider />

      {/* Sub / Super */}
      <ToolbarButton tooltip="כתב עילי" active={editor.isActive('superscript')} onClick={() => editor.chain().focus().toggleSuperscript().run()}>
        <SupIcon className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton tooltip="כתב תחתי" active={editor.isActive('subscript')} onClick={() => editor.chain().focus().toggleSubscript().run()}>
        <SubIcon className="h-4 w-4" />
      </ToolbarButton>
      <Divider />

      {/* Color & Highlight */}
      <ColorPalettePopover
        icon={<Palette className="h-4 w-4" />}
        tooltip="צבע טקסט"
        onPickColor={(color) => editor.chain().focus().setColor(color).run()}
        onClear={() => editor.chain().focus().unsetColor().run()}
      />
      <ColorPalettePopover
        icon={<Highlighter className="h-4 w-4" />}
        tooltip="צבע הדגשה"
        active={editor.isActive('highlight')}
        onPickColor={(color) => editor.chain().focus().toggleHighlight({ color }).run()}
        onClear={() => editor.chain().focus().unsetHighlight().run()}
      />
      <ToolbarButton tooltip="הסר צבע" onClick={() => editor.chain().focus().unsetColor().unsetHighlight().run()}>
        <Type className="h-4 w-4" />
      </ToolbarButton>
      <Divider />

      {/* Alignment */}
      <ToolbarButton tooltip="ישור לימין" active={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()}>
        <AlignRight className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton tooltip="ישור למרכז" active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()}>
        <AlignCenter className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton tooltip="ישור לשמאל" active={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()}>
        <AlignLeft className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton tooltip="ישור לשני הצדדים" active={editor.isActive({ textAlign: 'justify' })} onClick={() => editor.chain().focus().setTextAlign('justify').run()}>
        <AlignJustify className="h-4 w-4" />
      </ToolbarButton>
      <Divider />

      {/* Direction (visual hint via alignment) */}
      <ToolbarButton tooltip="כיוון ימין-לשמאל (RTL)" onClick={() => setDirection('rtl')}>
        <span className="text-xs font-bold">RTL</span>
      </ToolbarButton>
      <ToolbarButton tooltip="כיוון שמאל-לימין (LTR)" onClick={() => setDirection('ltr')}>
        <span className="text-xs font-bold">LTR</span>
      </ToolbarButton>
      <Divider />

      {/* Lists */}
      <ToolbarButton tooltip="רשימת תבליטים" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <List className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton tooltip="רשימה ממוספרת" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <ListOrdered className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton tooltip="רשימת משימות" active={editor.isActive('taskList')} onClick={() => editor.chain().focus().toggleTaskList().run()}>
        <ListChecks className="h-4 w-4" />
      </ToolbarButton>
      <Divider />

      {/* Blockquote / Code / HR */}
      <ToolbarButton tooltip="ציטוט" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
        <Quote className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton tooltip="קוד מוטבע" active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()}>
        <Code className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton tooltip="בלוק קוד" active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
        <Code2 className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton tooltip="קו מפריד" onClick={() => editor.chain().focus().setHorizontalRule().run()}>
        <Minus className="h-4 w-4" />
      </ToolbarButton>
      <Divider />

      {/* Link / Image / Table */}
      <ToolbarButton tooltip="הוסף קישור" active={editor.isActive('link')} onClick={setLink}>
        <LinkIcon className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton tooltip="הוסף תמונה" onClick={insertImage}>
        <ImageIcon className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton tooltip="הוסף טבלה" onClick={insertTable}>
        <TableIcon className="h-4 w-4" />
      </ToolbarButton>
    </div>
  );
}