"use client";
import {useEffect} from "react";
import {useEditor,EditorContent,type JSONContent} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {Button} from "@/components/ui/button";
export {type JSONContent} from "@tiptap/react";
export function RichTextEditor({value,onChange,disabled=false,label="正文"}:{value:JSONContent;onChange:(value:JSONContent)=>void;disabled?:boolean;label?:string}){
 const editor=useEditor({extensions:[StarterKit.configure({link:{openOnClick:false,protocols:["https","http","mailto"],HTMLAttributes:{rel:"noopener noreferrer nofollow"}}})],content:value,immediatelyRender:false,editable:!disabled,
  editorProps:{attributes:{"aria-label":label,role:"textbox","aria-multiline":"true",class:"min-h-40 p-3 outline-none [&_p]:my-2 [&_h2]:text-xl [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6"}},
  onUpdate:({editor})=>onChange(editor.getJSON())});
 useEffect(()=>{if(editor&&JSON.stringify(editor.getJSON())!==JSON.stringify(value))editor.commands.setContent(value,{emitUpdate:false});},[editor,value]);
 useEffect(()=>{editor?.setEditable(!disabled,false);},[editor,disabled]);
 return <section className="rounded-lg border" aria-label={label+"编辑器"}><div className="flex flex-wrap gap-1 border-b p-2" role="toolbar" aria-label="文字格式">
  <Button type="button" size="sm" variant="ghost" aria-pressed={editor?.isActive("bold")||false} disabled={disabled||!editor} onClick={()=>editor?.chain().focus().toggleBold().run()}>加粗</Button>
  <Button type="button" size="sm" variant="ghost" aria-pressed={editor?.isActive("italic")||false} disabled={disabled||!editor} onClick={()=>editor?.chain().focus().toggleItalic().run()}>斜体</Button>
  <Button type="button" size="sm" variant="ghost" aria-pressed={editor?.isActive("bulletList")||false} disabled={disabled||!editor} onClick={()=>editor?.chain().focus().toggleBulletList().run()}>列表</Button>
  <Button type="button" size="sm" variant="ghost" disabled={disabled||!editor?.can().undo()} onClick={()=>editor?.chain().focus().undo().run()}>撤销</Button>
  <Button type="button" size="sm" variant="ghost" disabled={disabled||!editor?.can().redo()} onClick={()=>editor?.chain().focus().redo().run()}>重做</Button>
 </div><EditorContent editor={editor}/></section>;
}
