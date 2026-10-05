import React from 'react';
import {Droppable,Draggable} from '@hello-pangea/dnd';
import QuoteItemEditor from '@/components/modularQuote/QuoteItemEditor';
import {reorderItems} from '@/components/modularQuote/quoteDefaults';
export default function QuoteItemsList({items=[],listId,services,onChange,child=false}) {
  return <Droppable droppableId={listId} type={listId}>{provided=><div ref={provided.innerRef} {...provided.droppableProps} className="space-y-3 min-w-0">
    {items.map((item,index)=><Draggable key={item.id} draggableId={item.id} index={index}>{drag=><div ref={drag.innerRef} {...drag.draggableProps} style={drag.draggableProps.style}>
      <QuoteItemEditor item={item} index={index} total={items.length} services={services} child={child} dragHandleProps={drag.dragHandleProps} onChange={value=>onChange(items.map((s,i)=>i===index?value:s))} onRemove={()=>onChange(items.filter((_,i)=>i!==index))} onMove={dir=>onChange(reorderItems(items,index,index+dir),true)}/>
    </div>}</Draggable>)}{provided.placeholder}
  </div>}</Droppable>;
}