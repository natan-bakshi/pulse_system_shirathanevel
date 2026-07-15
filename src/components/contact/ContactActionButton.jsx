import React from 'react';
import { Button } from '@/components/ui/button';

export default function ContactActionButton({ icon: Icon, label, href, onClick, className = '' }) {
  const content = <Icon className="h-4 w-4" />;
  if (href) {
    return (
      <Button variant="ghost" size="icon" asChild className={`h-9 w-9 ${className}`} aria-label={label} title={label}>
        <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel={href.startsWith('http') ? 'noopener noreferrer' : undefined}>
          {content}
        </a>
      </Button>
    );
  }
  return (
    <Button type="button" variant="ghost" size="icon" onClick={onClick} className={`h-9 w-9 ${className}`} aria-label={label} title={label}>
      {content}
    </Button>
  );
}