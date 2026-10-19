import type { Pool } from 'pg';

/**
 * Connects a workspace to a spreadsheet, or (with `undefined`) disconnects it. Returns false if the
 * workspace does not exist. From then on every committed change in the workspace queues a sync job.
 */
export async function setSheetsIntegration(
  pool: Pool,
  workspaceId: string,
  spreadsheetId: string | undefined,
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE workspaces
        SET integrations = CASE
              WHEN $2::text IS NULL THEN integrations - 'sheets'
              ELSE jsonb_set(integrations, '{sheets}', jsonb_build_object('spreadsheetId', $2::text))
            END
      WHERE id = $1
      RETURNING id`,
    [workspaceId, spreadsheetId ?? null],
  );
  return result.rows.length > 0;
}
