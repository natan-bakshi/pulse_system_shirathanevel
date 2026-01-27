import React from 'react';
import ReactMarkdown from 'react-markdown';
import { cn } from "@/lib/utils";
import { Sparkles, User } from 'lucide-react';

export default function MessageBubble({ message }) {
    const isUser = message.role === 'user';
    
    return (
        <div className={cn("flex items-start gap-4", isUser ? "justify-end" : "justify-start")}>
            {/* AI Avatar */}
            {!isUser && (
                <div className="flex-shrink-0 h-10 w-10 rounded-full bg-red-800 flex items-center justify-center text-white shadow-md">
                    <Sparkles className="h-6 w-6" />
                </div>
            )}

            {/* Message Content */}
            <div className={cn(
                "max-w-[85%] rounded-2xl px-4 py-3 shadow-sm",
                isUser 
                    ? "bg-white text-gray-800 border border-gray-200" 
                    : "bg-red-800 text-white"
            )}>
                <ReactMarkdown 
                    className="prose prose-sm prose-invert max-w-none prose-p:my-0 prose-headings:my-2 prose-ul:my-1 prose-li:my-0.5"
                    components={{
                        a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" className="text-amber-400 hover:underline" />,
                    }}
                >
                    {message.content}
                </ReactMarkdown>
            </div>
            
            {/* User Avatar */}
            {isUser && (
                <div className="flex-shrink-0 h-10 w-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 shadow-md">
                    <User className="h-6 w-6" />
                </div>
            )}
        </div>
    );
}