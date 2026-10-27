import { Check, Minus } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CAPABILITY_GROUPS, ROLE_DESCRIPTIONS, ROLE_LABELS, WORKSPACE_ROLES, can } from "@/lib/permissions";

/** Read-only matrix of what each role can do. Computed from the same `can()` used for server-side enforcement. */
export function RoleMatrix() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Roles &amp; permissions</CardTitle>
        <CardDescription>These rules are enforced on the server for every request, whatever the screen shows.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {WORKSPACE_ROLES.map((r) => (
            <div key={r} className="rounded-xl bg-muted p-3">
              <dt className="text-sm font-semibold">{ROLE_LABELS[r]}</dt>
              <dd className="mt-1 text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[r]}</dd>
            </div>
          ))}
        </dl>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <caption className="sr-only">Capabilities by role</caption>
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th scope="col" className="py-2 pr-3 text-left font-medium">Capability</th>
                {WORKSPACE_ROLES.map((r) => (
                  <th key={r} scope="col" className="px-3 py-2 text-center font-medium">{ROLE_LABELS[r]}</th>
                ))}
              </tr>
            </thead>
            {CAPABILITY_GROUPS.map((g) => (
              <tbody key={g.group}>
                <tr>
                  <th scope="rowgroup" colSpan={5} className="pt-4 pb-1 text-left text-xs font-semibold tracking-wide text-primary uppercase">{g.group}</th>
                </tr>
                {g.rows.map((row) => (
                  <tr key={row.action} className="border-b last:border-0">
                    <th scope="row" className="py-2 pr-3 text-left font-normal">{row.label}</th>
                    {WORKSPACE_ROLES.map((r) => (
                      <td key={r} className="px-3 py-2 text-center">
                        {can(r, row.action) ? (
                          <Check className="mx-auto size-4 text-primary" aria-label="Allowed" />
                        ) : (
                          <Minus className="mx-auto size-4 text-muted-foreground/50" aria-label="Not allowed" />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
