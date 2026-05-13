# Supabase

This directory contains the local Supabase configuration for ESMARK-CONTROL.

## Structure

```
supabase/
├── migrations/          # SQL migrations applied in order
│   ├── 20240101000000_add_trello_fields_pedidos_danados.sql
│   └── 20240101000001_create_reportes_generados.sql
├── functions/           # Deno Edge Functions
│   ├── trello_cards_by_my_area/
│   │   └── index.ts
│   └── generar_reporte_csv/
│       └── index.ts
└── README.md
```

## Getting Started

1. Install the Supabase CLI: `npm install -g supabase`
2. Link your project: `supabase link --project-ref <YOUR_PROJECT_REF>`
3. Apply migrations: `supabase db push`
4. Deploy edge functions: `supabase functions deploy`

## Environment Variables

Set these in your `.env` (or in the Supabase dashboard for edge functions):

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | Public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key (edge functions only) |
| `TRELLO_API_KEY` | Trello API key |
| `TRELLO_TOKEN` | Trello OAuth token |
