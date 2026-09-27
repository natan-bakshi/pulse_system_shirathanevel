import React from "react";
import { Button } from "@/components/ui/button";

export default function AdminClosingVerification({password,onChange,onSubmit,busy,ready}) {
  return <form className="space-y-3 border-t pt-4" onSubmit={e=>{e.preventDefault();onSubmit();}}>
    <label className="block">אימות מנהל ללא וואטסאפ
      <input type="password" className="w-full rounded-md border p-3 bg-white" autoComplete="off" value={password} onChange={e=>onChange(e.target.value)}/>
    </label>
    <Button disabled={busy||!ready||!password}>אמת באמצעות סיסמת מנהל</Button>
  </form>;
}