/**
 * Reordenação Reverse Cuthill–McKee do grafo de nós — reduz o perfil (skyline) da matriz
 * de rigidez. Em pontes estaiadas/pênseis a numeração "natural" do gerador (tabuleiro,
 * depois torre, depois cabos) tem banda enorme; com RCM ela cai p/ a largura de uma "fatia".
 */

function bfsLevels(start: number, adj: number[][], mark: Int32Array, stamp: number): { last: number; depth: number; order: number[] } {
  const order: number[] = [start]
  mark[start] = stamp
  let head = 0
  let levelEnd = 1
  let depth = 0
  let last = start
  while (head < order.length) {
    if (head === levelEnd) {
      depth++
      levelEnd = order.length
    }
    const v = order[head++]
    last = v
    for (const w of adj[v]) {
      if (mark[w] !== stamp) {
        mark[w] = stamp
        order.push(w)
      }
    }
  }
  return { last, depth, order }
}

/** devolve `order`, onde order[k] = índice do nó na posição k da nova numeração */
export function rcmOrder(n: number, adj: number[][]): Int32Array {
  const result: number[] = []
  const placed = new Uint8Array(n)
  const mark = new Int32Array(n).fill(-1)
  let stamp = 0
  const deg = adj.map((a) => a.length)

  for (let seed = 0; seed < n; seed++) {
    if (placed[seed]) continue
    // nó pseudo-periférico: parte do nó de menor grau do componente e caminha p/ o mais distante
    const comp = bfsLevels(seed, adj, mark, stamp++).order
    let start = comp[0]
    for (const v of comp) if (deg[v] < deg[start]) start = v
    let depth = -1
    for (let it = 0; it < 8; it++) {
      const r = bfsLevels(start, adj, mark, stamp++)
      if (r.depth <= depth) break
      depth = r.depth
      start = r.last
    }
    // Cuthill–McKee: BFS visitando vizinhos por grau crescente
    const queue: number[] = [start]
    placed[start] = 1
    let head = 0
    while (head < queue.length) {
      const v = queue[head++]
      const nb = adj[v].filter((w) => !placed[w]).sort((a, b) => deg[a] - deg[b])
      for (const w of nb) {
        if (!placed[w]) {
          placed[w] = 1
          queue.push(w)
        }
      }
    }
    for (const v of queue) result.push(v)
  }
  result.reverse()
  return Int32Array.from(result)
}
