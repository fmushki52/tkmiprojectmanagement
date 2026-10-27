"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { profileSchema } from "@/lib/validation";
import { updateProfileAction } from "./actions";

type Values = z.input<typeof profileSchema>;

export function ProfileForm({ name, email }: { name: string; email: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(profileSchema), defaultValues: { name } });

  async function onSubmit(values: Values) {
    setPending(true);
    const res = await updateProfileAction(values);
    setPending(false);
    if (!res.ok) {
      setError("name", { message: res.fieldErrors?.name?.[0] ?? res.error });
      return void toast.error(res.error);
    }
    toast.success("Profile updated");
    router.refresh();
  }

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>Your name is shown to teammates on tasks, comments and updates.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4" noValidate>
          <Field label="Name" htmlFor="profile-name" error={errors.name?.message}>
            <Input id="profile-name" autoComplete="name" aria-invalid={!!errors.name} {...register("name")} />
          </Field>
          <Field label="Email" htmlFor="profile-email" hint="Email cannot be changed here.">
            <Input id="profile-email" value={email} readOnly disabled />
          </Field>
          <div>
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save profile"}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
