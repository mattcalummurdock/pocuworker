import { config } from "dotenv";
config();

import { createClient } from "@supabase/supabase-js";

async function main() {
  const sb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data, error } = await sb
    .from("training_jobs")
    .select("id, status, created_at, error_message")
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw error;
  console.log(JSON.stringify(data, null, 2));

  const { data: byStatus } = await sb.from("training_jobs").select("status");
  const counts: Record<string, number> = {};
  for (const row of byStatus ?? []) {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
  }
  console.log("counts:", counts);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
