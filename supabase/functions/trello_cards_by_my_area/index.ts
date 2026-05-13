import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

interface TrelloCard {
  id: string;
  name: string;
  url: string;
  idList: string;
  pos: number;
  desc?: string;
  attachments?: unknown[];
  attachmentCount?: number;
}

interface TrelloList {
  id: string;
  name: string;
  pos: number;
}

interface TrelloCardWithLocation {
  id: string;
  name: string;
  url: string;
  idList: string;
  listName: string;
  listPos: number;
  pos: number;
  desc?: string;
  attachmentCount?: number;
}

serve(async (req: Request) => {
  const h = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: h });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: h });
  }

  try {
    const body = await req.json();
    const bid = (body.boardId || '').trim();
    if (!bid) {
      return new Response(JSON.stringify({ error: 'No boardId' }), { status: 400, headers: h });
    }

    const key = Deno.env.get('TRELLO_API_KEY') || '';
    const tok = Deno.env.get('TRELLO_TOKEN') || '';
    if (!key || !tok) {
      return new Response(JSON.stringify({ error: 'No secrets', k: !!key, t: !!tok }), { status: 500, headers: h });
    }

    const meUrl = `https://api.trello.com/1/members/me?key=${key}&token=${tok}`;
    const meRes = await fetch(meUrl);
    if (!meRes.ok) {
      const text = await meRes.text();
      return new Response(
        JSON.stringify({
          error: 'Trello credentials invalid',
          status: meRes.status,
          text,
          hint: 'Revisa que TRELLO_API_KEY y TRELLO_TOKEN pertenezcan a la misma cuenta de servicio.',
        }),
        { status: 502, headers: h },
      );
    }

    const listsUrl = `https://api.trello.com/1/boards/${bid}/lists?key=${key}&token=${tok}&fields=id,name,pos`;
    const listsRes = await fetch(listsUrl);

    if (!listsRes.ok) {
      const text = await listsRes.text();
      return new Response(
        JSON.stringify({ error: 'Trello lists error', status: listsRes.status, text }),
        { status: 502, headers: h },
      );
    }

    const lists = (await listsRes.json()) as TrelloList[];
    const listMeta = new Map(lists.map((list) => [list.id, { name: list.name, pos: list.pos ?? 0 }]));

    const url = `https://api.trello.com/1/boards/${bid}/cards?key=${key}&token=${tok}&fields=id,name,url,idList,pos,desc&attachments=open`;
    const res = await fetch(url);

    if (!res.ok) {
      const text = await res.text();
      return new Response(
        JSON.stringify({
          error: 'Trello error',
          status: res.status,
          text,
          hint: 'Si el error es 401 invalid key, reemplaza la API Key por una nueva de la cuenta de servicio.',
        }),
        { status: 502, headers: h },
      );
    }

    const cards = (await res.json()) as TrelloCard[];
    const cardsWithLocation: TrelloCardWithLocation[] = cards
      .map((card) => {
        const meta = listMeta.get(card.idList);
        return {
          id: card.id,
          name: card.name,
          url: card.url,
          idList: card.idList,
          listName: meta?.name ?? 'Sin ubicación',
          listPos: meta?.pos ?? 0,
          pos: card.pos,
          desc: card.desc,
          attachmentCount: (card.attachments ?? []).length,
        };
      })
      .sort((a, b) => {
        if (a.listPos === b.listPos) return a.pos - b.pos;
        return a.listPos - b.listPos;
      });

    return new Response(JSON.stringify({ cards: cardsWithLocation, boardId: bid }), { status: 200, headers: h });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: 'Exception', msg }), { status: 500, headers: h });
  }
});
