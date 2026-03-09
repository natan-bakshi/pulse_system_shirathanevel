import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import EventsBoard from '../components/events/EventsBoard';

export default function EventsBoardPage() {
    return (
        <div className="p-2 sm:p-4 lg:p-8 max-w-full mx-auto w-full">
            <Card className="bg-white/95 backdrop-blur-sm shadow-xl">
                <CardHeader className="p-3 sm:p-6">
                    <CardTitle className="text-xl sm:text-2xl">לוח אירועים</CardTitle>
                </CardHeader>
                <CardContent className="p-3 sm:p-6 min-w-0">
                    <EventsBoard />
                </CardContent>
            </Card>
        </div>
    );
}