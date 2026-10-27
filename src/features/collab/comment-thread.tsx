"use client";

import { MessageSquare, Reply, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/lib/use-action";
import { addCommentAction, deleteCommentAction, loadCommentsAction } from "./actions";

type Target = { taskId: string } | { milestoneId: string } | { updateId: string };
interface Comment {
  id: string;
  parentId: string | null;
  authorId: string | null;
  authorName: string | null;
  body: string;
  deleted: boolean;
  createdAt: string;
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/**
 * Comments with one level of replies and @mentions (inserted from the picker as "@Full Name").
 * Notifications for mentions/comments are created by the server.
 */
export function CommentThread({
  target,
  people,
  currentUserId,
  canComment,
  canModerate,
}: {
  target: Target;
  people: { userId: string; name: string }[];
  currentUserId: string;
  canComment: boolean;
  canModerate: boolean;
}) {
  const { run, pending } = useAction();
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const key = JSON.stringify(target);

  const [version, setVersion] = useState(0);
  const reload = () => setVersion((v) => v + 1);

  useEffect(() => {
    let cancelled = false;
    loadCommentsAction(JSON.parse(key)).then((res) => {
      if (!cancelled && res.ok) setComments(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, [key, version]);

  async function submit() {
    if (!body.trim()) return;
    const res = await run(() => addCommentAction(target, { body }, replyTo), { refresh: false });
    if (res.ok) {
      setBody("");
      setReplyTo(null);
      reload();
    }
  }

  const roots = (comments ?? []).filter((c) => !c.parentId);
  const render = (c: Comment, nested = false) => (
    <li key={c.id} className={nested ? "ml-6 border-l pl-3" : ""}>
      <div className="rounded-lg bg-muted/50 p-2.5 text-sm">
        <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{c.authorName ?? "Former member"}</span>
          <time dateTime={c.createdAt}>{when(c.createdAt)}</time>
        </div>
        {c.deleted ? <p className="text-muted-foreground italic">This comment was deleted.</p> : <p className="break-words whitespace-pre-wrap">{c.body}</p>}
        {!c.deleted ? (
          <div className="mt-1 flex gap-1">
            {canComment && !nested ? (
              <Button variant="ghost" size="xs" onClick={() => setReplyTo(c.id)}>
                <Reply /> Reply
              </Button>
            ) : null}
            {c.authorId === currentUserId || canModerate ? (
              <ConfirmDialog
                trigger={
                  <Button variant="ghost" size="xs" aria-label="Delete comment">
                    <Trash2 /> Delete
                  </Button>
                }
                title="Delete this comment?"
                description="The comment will be removed from the conversation."
                onConfirm={async () => {
                  await run(() => deleteCommentAction(c.id), { refresh: false, success: "Comment deleted" });
                  reload();
                }}
              />
            ) : null}
          </div>
        ) : null}
      </div>
      {(comments ?? []).filter((r) => r.parentId === c.id).length ? (
        <ul className="mt-2 grid gap-2">{(comments ?? []).filter((r) => r.parentId === c.id).map((r) => render(r, true))}</ul>
      ) : null}
    </li>
  );

  return (
    <section aria-label="Comments" className="grid gap-3">
      <h3 className="flex items-center gap-1.5 text-sm font-medium">
        <MessageSquare className="size-4" /> Comments {comments ? `(${comments.filter((c) => !c.deleted).length})` : ""}
      </h3>
      {comments === null ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {comments && roots.length === 0 ? <p className="text-sm text-muted-foreground">No comments yet.</p> : null}
      <ul className="grid gap-2">{roots.map((c) => render(c))}</ul>
      {canComment ? (
        <div className="grid gap-2">
          {replyTo ? (
            <p className="text-xs text-muted-foreground">
              Replying to a comment.{" "}
              <button type="button" className="underline" onClick={() => setReplyTo(null)}>
                Cancel
              </button>
            </p>
          ) : null}
          <Textarea aria-label="Write a comment" rows={2} placeholder="Write a comment…" value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="flex items-center gap-2">
            <NativeSelect
              aria-label="Mention a teammate"
              className="w-44"
              value=""
              onChange={(e) => {
                const p = people.find((x) => x.userId === e.target.value);
                if (p) setBody((b) => `${b}${b && !b.endsWith(" ") ? " " : ""}@${p.name} `);
              }}
            >
              <option value="">@ Mention…</option>
              {people.map((p) => (
                <option key={p.userId} value={p.userId}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
            <Button size="sm" className="ml-auto" disabled={pending || !body.trim()} onClick={submit}>
              {replyTo ? "Reply" : "Comment"}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
