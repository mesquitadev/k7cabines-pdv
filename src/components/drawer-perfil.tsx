import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Lock, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PainelLateral, SecaoForm } from "@/components/painel-lateral";
import { Rotulo } from "@/components/placa";
import {
  desktop,
  desktopToken,
  type LocalPermissionInfo,
  type LocalRoleInfo,
} from "@/lib/desktop";
import { cn } from "@/lib/utils";

/**
 * Criação e edição de perfil de acesso.
 *
 * O perfil é o padrão que a conta herda; a exceção por pessoa continua
 * existindo por cima dele. Ter os dois evita o erro clássico de criar um perfil
 * novo toda vez que uma pessoa precisa de um clique a mais.
 */
export function DrawerPerfil({
  papel,
  criando,
  permissoes,
  onFechar,
  onSalvo,
}: {
  /** Papel em edição; nulo quando se está criando. */
  papel: LocalRoleInfo | null;
  criando: boolean;
  permissoes: LocalPermissionInfo[];
  onFechar: () => void;
  onSalvo: () => void | Promise<void>;
}) {
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  /* Pedido do cliente (24/09/2026): o dono decide quantos dias o funcionário olha para trás. */
  const [diasHistorico, setDiasHistorico] = useState("0");
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [salvando, setSalvando] = useState(false);

  const aberto = criando || !!papel;
  const sistema = papel?.is_system ?? false;

  useEffect(() => {
    if (!aberto) return;
    setNome(papel?.name ?? "");
    setDescricao(papel?.description ?? "");
    setDiasHistorico(String(papel?.history_days ?? 0));
    setMarcadas(new Set(papel?.permissions ?? []));
  }, [aberto, papel]);

  const grupos = useMemo(() => {
    const mapa = new Map<string, LocalPermissionInfo[]>();
    permissoes.forEach((p) => {
      const lista = mapa.get(p.grupo) ?? [];
      lista.push(p);
      mapa.set(p.grupo, lista);
    });
    return [...mapa.entries()];
  }, [permissoes]);

  const alternar = (chave: string) => {
    setMarcadas((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(chave)) proximo.delete(chave);
      else proximo.add(chave);
      return proximo;
    });
  };

  const alternarGrupo = (itens: LocalPermissionInfo[]) => {
    const todas = itens.every((i) => marcadas.has(i.key));
    setMarcadas((atual) => {
      const proximo = new Set(atual);
      itens.forEach((i) => (todas ? proximo.delete(i.key) : proximo.add(i.key)));
      return proximo;
    });
  };

  const salvar = async () => {
    const token = desktopToken();
    if (!token) return toast.error("Sessão local expirada. Entre novamente.");
    if (!sistema && nome.trim().length < 3) {
      return toast.error("O nome do perfil precisa de pelo menos 3 caracteres");
    }
    if (marcadas.size === 0) {
      return toast.error("Marque ao menos uma permissão: um perfil vazio não deixa fazer nada");
    }

    const dias = Number.parseInt(diasHistorico, 10);
    if (!Number.isFinite(dias) || dias < 0 || dias > 3650) {
      return toast.error("Dias de histórico: use um número entre 0 (tudo) e 3650");
    }
    const dados = {
      name: nome.trim(),
      description: descricao.trim(),
      permissions: [...marcadas],
      history_days: dias,
    };

    setSalvando(true);
    try {
      if (papel) {
        await desktop.updateRole(token, papel.key, dados);
        toast.success(`Perfil ${papel.name} atualizado`);
      } else {
        await desktop.createRole(token, dados);
        toast.success("Perfil criado");
      }
      onFechar();
      await onSalvo();
    } catch (erro) {
      toast.error(typeof erro === "string" ? erro : "Não foi possível salvar o perfil");
    } finally {
      setSalvando(false);
    }
  };

  const excluir = async () => {
    if (!papel) return;
    const token = desktopToken();
    if (!token) return;
    setSalvando(true);
    try {
      await desktop.deleteRole(token, papel.key);
      toast.success(`Perfil ${papel.name} excluído`);
      onFechar();
      await onSalvo();
    } catch (erro) {
      toast.error(typeof erro === "string" ? erro : "Não foi possível excluir");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <PainelLateral
      aberto={aberto}
      onAbertoMudou={(a) => !a && onFechar()}
      icone={ShieldCheck}
      titulo={papel ? `Perfil ${papel.name}` : "Novo perfil"}
      descricao={
        papel
          ? `${papel.user_count} conta(s) usam este perfil${sistema ? " · perfil de fábrica" : ""}`
          : "O padrão de permissões que a conta herda ao ser criada."
      }
      selo={sistema ? "fábrica" : undefined}
      largura="sm:max-w-2xl"
      confirmarDescarte={criando && nome.trim().length > 0}
      rodape={
        <>
          {papel && !sistema && (
            <Button
              variant="ghost"
              className="acao-destrutiva mr-auto h-11 rounded-sm px-4"
              disabled={salvando || papel.user_count > 0}
              title={
                papel.user_count > 0
                  ? "Mova as contas para outro perfil antes de excluir"
                  : undefined
              }
              onClick={excluir}
            >
              <Trash2 className="mr-2 h-4 w-4" aria-hidden /> Excluir
            </Button>
          )}
          <Button variant="outline" className="h-11 rounded-sm px-5" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            variant="ghost"
            className="acao-receber h-11 rounded-sm px-6 font-bold uppercase"
            disabled={salvando || marcadas.size === 0}
            onClick={salvar}
            style={{ fontFamily: "var(--font-display)" }}
          >
            {salvando ? "Salvando…" : "Salvar"}
          </Button>
        </>
      }
    >
      <SecaoForm titulo="Identificação">
        <div className="space-y-1.5">
          <Label htmlFor="perfilNome">Nome do perfil</Label>
          <Input
            id="perfilNome"
            autoFocus={criando}
            disabled={sistema}
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Ex.: Conferente de estoque"
            className="campo h-11 rounded-sm"
          />
          {sistema && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Lock className="h-3 w-3" aria-hidden />
              Perfil de fábrica: o nome é fixo porque ele já está gravado no histórico de quem o
              teve. As permissões você ajusta à vontade.
            </p>
          )}
        </div>
        {!sistema && (
          <div className="space-y-1.5">
            <Label htmlFor="perfilDesc">Descrição</Label>
            <Input
              id="perfilDesc"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Para que serve este perfil"
              className="campo h-11 rounded-sm"
            />
          </div>
        )}
        {!papel?.is_master && (
          <div className="space-y-1.5">
            <Label htmlFor="perfilHistorico">Dias de histórico de vendas visíveis (0 = tudo)</Label>
            <Input
              id="perfilHistorico"
              type="number"
              inputMode="numeric"
              min={0}
              max={3650}
              value={diasHistorico}
              onChange={(e) => setDiasHistorico(e.target.value)}
              className="campo h-11 w-40 rounded-sm"
            />
            <p className="text-xs text-muted-foreground">
              Nos relatórios, quem tem este perfil só consulta a partir de hoje menos esses dias.
            </p>
          </div>
        )}
      </SecaoForm>

      <SecaoForm titulo={`Permissões — ${marcadas.size} marcada(s)`}>
        {grupos.map(([grupo, itens]) => {
          const todas = itens.every((i) => marcadas.has(i.key));
          return (
            <div key={grupo} className="painel overflow-hidden">
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <Rotulo>{grupo}</Rotulo>
                <button
                  type="button"
                  onClick={() => alternarGrupo(itens)}
                  className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  {todas ? "Desmarcar tudo" : "Marcar tudo"}
                </button>
              </div>
              <div className="divide-y divide-border">
                {itens.map((perm) => (
                  <label
                    key={perm.key}
                    className="flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-accent/40"
                  >
                    <input
                      type="checkbox"
                      className="marcador mt-0.5 shrink-0"
                      checked={marcadas.has(perm.key)}
                      onChange={() => alternar(perm.key)}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm">{perm.rotulo}</span>
                      {perm.descricao && (
                        <span className="block text-xs text-muted-foreground">
                          {perm.descricao}
                        </span>
                      )}
                      <span
                        className={cn(
                          "rotulo num block text-[10px]",
                          marcadas.has(perm.key) ? "text-muted-foreground" : "text-transparent",
                        )}
                      >
                        {perm.key}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </SecaoForm>
    </PainelLateral>
  );
}
