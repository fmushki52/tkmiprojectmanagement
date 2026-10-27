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
import { workspaceSchema } from "@/lib/validation";
import { createWorkspaceAction } from "./actions";

type Values = z.input<typeof workspaceSchema>;

export function CreateWorkspaceForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(workspaceSchema) });

  async function onSubmit(values: Values) {
    setPending(true);
    const res = await createWorkspaceAction(values);
    setPending(false);
    if (!res.ok) {
      setError("name", { message: res.fieldErrors?.name?.[0] ?? res.error });
      toast.error(res.error);
      return;
    }
    toast.success("Workspace created");
    router.replace(`/w/${res.data.slug}`);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create a workspace</CardTitle>
        <CardDescription>A workspace holds your projects and team. You will be its owner.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4" noValidate>
          <Field label="Workspace name" htmlFor="name" error={errors.name?.message}>
            <Input id="name" placeholder="Acme Inc." autoFocus aria-invalid={!!errors.name} {...register("name")} />
          </Field>
          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create workspace"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
