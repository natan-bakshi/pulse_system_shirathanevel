import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";

export default function SyncPhonesButton() {
    const [loading, setLoading] = useState(false);

    const handleSync = async () => {
        setLoading(true);
        try {
            const response = await base44.functions.invoke('syncSupplierPhonesToUsers', {});
            
            if (response.data?.success) {
                const { processed_suppliers, updates_count } = response.data;
                toast.success("סנכרון הושלם בהצלחה", {
                    description: `נבדקו ${processed_suppliers} ספקים, בוצעו ${updates_count} עדכונים.`
                });
            } else {
                toast.error("שגיאה בסנכרון", {
                    description: response.data?.error || "אירעה שגיאה לא ידועה"
                });
            }
        } catch (error) {
            console.error("Sync error:", error);
            toast.error("שגיאה בהפעלת הסנכרון", {
                description: error.message
            });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Button 
            variant="outline" 
            size="sm" 
            onClick={handleSync} 
            disabled={loading}
            className="gap-2"
        >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'מסנכרן...' : 'סנכרון טלפונים'}
        </Button>
    );
}