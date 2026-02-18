from flask import Flask, render_template, request, redirect, url_for, flash, jsonify
from database import get_db, init_db

app = Flask(__name__)
app.secret_key = "farma-manipulacao-secret-key"


@app.before_request
def before_request():
    init_db()


# ── Helpers ──────────────────────────────────────────────────────────────────


def get_grupos():
    db = get_db()
    grupos = db.execute("SELECT * FROM grupos ORDER BY codigo").fetchall()
    db.close()
    return grupos


def get_fornecedores():
    db = get_db()
    fornecedores = db.execute(
        "SELECT * FROM fornecedores ORDER BY codigo"
    ).fetchall()
    db.close()
    return fornecedores


def parse_float(value, default=None):
    if value is None or value == "":
        return default
    try:
        return float(str(value).replace(",", "."))
    except (ValueError, TypeError):
        return default


def parse_int(value, default=0):
    try:
        return int(value)
    except (ValueError, TypeError):
        return default


# ── Routes ───────────────────────────────────────────────────────────────────


@app.route("/")
def index():
    db = get_db()
    filtro_grupo = request.args.get("grupo", "")
    busca = request.args.get("busca", "")

    query = """
        SELECT p.*, g.nome as grupo_nome, g.codigo as grupo_codigo,
               f.nome as fornecedor_nome
        FROM produtos p
        LEFT JOIN grupos g ON p.grupo_id = g.id
        LEFT JOIN fornecedores f ON p.fornecedor_id = f.id
        WHERE p.produto_inativo = 0
    """
    params = []

    if filtro_grupo:
        query += " AND p.grupo_id = ?"
        params.append(filtro_grupo)

    if busca:
        query += " AND (p.descricao LIKE ? OR p.codigo LIKE ? OR p.codigo_barras LIKE ?)"
        params.extend([f"%{busca}%", f"%{busca}%", f"%{busca}%"])

    query += " ORDER BY p.codigo"

    produtos = db.execute(query, params).fetchall()
    grupos = get_grupos()
    db.close()

    return render_template(
        "index.html",
        produtos=produtos,
        grupos=grupos,
        filtro_grupo=filtro_grupo,
        busca=busca,
    )


@app.route("/produto/novo", methods=["GET", "POST"])
def produto_novo():
    if request.method == "POST":
        return salvar_produto(None)

    grupos = get_grupos()
    fornecedores = get_fornecedores()

    db = get_db()
    max_codigo = db.execute(
        "SELECT COALESCE(MAX(codigo), 100000) + 1 as proximo FROM produtos"
    ).fetchone()["proximo"]
    db.close()

    return render_template(
        "produto_form.html",
        produto=None,
        grupos=grupos,
        fornecedores=fornecedores,
        proximo_codigo=max_codigo,
    )


@app.route("/produto/<int:produto_id>", methods=["GET"])
def produto_detalhe(produto_id):
    db = get_db()
    produto = db.execute(
        """
        SELECT p.*, g.nome as grupo_nome, g.codigo as grupo_codigo,
               f.nome as fornecedor_nome
        FROM produtos p
        LEFT JOIN grupos g ON p.grupo_id = g.id
        LEFT JOIN fornecedores f ON p.fornecedor_id = f.id
        WHERE p.id = ?
    """,
        (produto_id,),
    ).fetchone()
    db.close()

    if not produto:
        flash("Produto não encontrado.", "error")
        return redirect(url_for("index"))

    return render_template("produto_detalhe.html", produto=produto)


@app.route("/produto/<int:produto_id>/editar", methods=["GET", "POST"])
def produto_editar(produto_id):
    if request.method == "POST":
        return salvar_produto(produto_id)

    db = get_db()
    produto = db.execute("SELECT * FROM produtos WHERE id = ?", (produto_id,)).fetchone()
    db.close()

    if not produto:
        flash("Produto não encontrado.", "error")
        return redirect(url_for("index"))

    grupos = get_grupos()
    fornecedores = get_fornecedores()

    return render_template(
        "produto_form.html",
        produto=produto,
        grupos=grupos,
        fornecedores=fornecedores,
        proximo_codigo=produto["codigo"],
    )


@app.route("/produto/<int:produto_id>/excluir", methods=["POST"])
def produto_excluir(produto_id):
    db = get_db()
    db.execute("DELETE FROM produtos WHERE id = ?", (produto_id,))
    db.commit()
    db.close()
    flash("Produto excluído com sucesso.", "success")
    return redirect(url_for("index"))


def salvar_produto(produto_id):
    form = request.form

    dados = {
        "codigo": parse_int(form.get("codigo")),
        "descricao": form.get("descricao", "").strip(),
        "grupo_id": parse_int(form.get("grupo_id")) or None,
        "codigo_barras": form.get("codigo_barras", "").strip() or None,
        "unidade_manipulacao": form.get("unidade_manipulacao", "mg"),
        "unidade_estoque": form.get("unidade_estoque", "g"),
        "valor_custo": parse_float(form.get("valor_custo"), 0),
        "custo_medio": parse_float(form.get("custo_medio"), 0),
        "custo_referencia": parse_float(form.get("custo_referencia"), 0),
        "markup": parse_float(form.get("markup"), 0),
        "valor_venda": parse_float(form.get("valor_venda"), 0),
        "ocultar_venda": 1 if form.get("ocultar_venda") else 0,
        "fator_correcao": parse_float(form.get("fator_correcao")),
        "fator_equivalencia": parse_float(form.get("fator_equivalencia")),
        "densidade": parse_float(form.get("densidade"), 1),
        "diluicao": parse_float(form.get("diluicao"), 1),
        "posicao_estoque": parse_float(form.get("posicao_estoque"), 0),
        "estoque_minimo": parse_float(form.get("estoque_minimo"), 0),
        "estoque_maximo": parse_float(form.get("estoque_maximo")),
        "dose_maxima": parse_float(form.get("dose_maxima")),
        "dose_maxima_um": form.get("dose_maxima_um", "").strip() or None,
        "dose_maxima_dia": parse_float(form.get("dose_maxima_dia")),
        "dose_maxima_dia_um": form.get("dose_maxima_dia_um", "").strip() or None,
        "concentracao": form.get("concentracao", "").strip() or None,
        "fornecedor_id": parse_int(form.get("fornecedor_id")) or None,
        "ultima_compra": form.get("ultima_compra") or None,
        "tipo_calculo": form.get("tipo_calculo", "Percentual"),
        "margem_seguranca": parse_float(form.get("margem_seguranca")),
        "curva_abc": form.get("curva_abc", "A"),
        "sbit_rdc": form.get("sbit_rdc", "").strip() or None,
        "descricao_rotulo": form.get("descricao_rotulo", "").strip() or None,
        "cas": form.get("cas", "").strip() or None,
        "lista_controlado": form.get("lista_controlado", "").strip() or None,
        "dcb": form.get("dcb", "").strip() or None,
        "dci": form.get("dci", "").strip() or None,
        "classe_terapeutica": form.get("classe_terapeutica", "").strip() or None,
        "antimicrobiano": 1 if form.get("antimicrobiano") else 0,
        "controle_especial": 1 if form.get("controle_especial") else 0,
        "uso_continuo": 1 if form.get("uso_continuo") else 0,
        "nbm_sh": form.get("nbm_sh", "").strip() or None,
        "ncm_sh": form.get("ncm_sh", "").strip() or None,
        "fabricante": form.get("fabricante", "").strip() or None,
        "num_licenca_mapa": form.get("num_licenca_mapa", "").strip() or None,
        "inativo_compras": 1 if form.get("inativo_compras") else 0,
        "produto_inativo": 1 if form.get("produto_inativo") else 0,
        "observacao": form.get("observacao", "").strip() or None,
    }

    if not dados["descricao"]:
        flash("Descrição é obrigatória.", "error")
        return redirect(request.url)

    db = get_db()

    if produto_id:
        campos = ", ".join(f"{k} = ?" for k in dados)
        valores = list(dados.values()) + [produto_id]
        db.execute(
            f"UPDATE produtos SET {campos}, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?",
            valores,
        )
        flash("Produto atualizado com sucesso.", "success")
    else:
        campos = ", ".join(dados.keys())
        placeholders = ", ".join("?" for _ in dados)
        db.execute(
            f"INSERT INTO produtos ({campos}) VALUES ({placeholders})",
            list(dados.values()),
        )
        flash("Produto cadastrado com sucesso.", "success")

    db.commit()
    db.close()

    return redirect(url_for("index"))


# ── Grupos & Fornecedores Management ─────────────────────────────────────────


@app.route("/grupos")
def listar_grupos():
    grupos = get_grupos()
    return render_template("grupos.html", grupos=grupos)


@app.route("/grupo/novo", methods=["POST"])
def grupo_novo():
    codigo = parse_int(request.form.get("codigo"))
    nome = request.form.get("nome", "").strip()
    if codigo and nome:
        db = get_db()
        try:
            db.execute(
                "INSERT INTO grupos (codigo, nome) VALUES (?, ?)", (codigo, nome)
            )
            db.commit()
            flash("Grupo criado com sucesso.", "success")
        except Exception:
            flash("Erro: código de grupo já existe.", "error")
        db.close()
    return redirect(url_for("listar_grupos"))


@app.route("/grupo/<int:grupo_id>/excluir", methods=["POST"])
def grupo_excluir(grupo_id):
    db = get_db()
    db.execute("DELETE FROM grupos WHERE id = ?", (grupo_id,))
    db.commit()
    db.close()
    flash("Grupo excluído.", "success")
    return redirect(url_for("listar_grupos"))


@app.route("/fornecedores")
def listar_fornecedores():
    fornecedores = get_fornecedores()
    return render_template("fornecedores.html", fornecedores=fornecedores)


@app.route("/fornecedor/novo", methods=["POST"])
def fornecedor_novo():
    codigo = parse_int(request.form.get("codigo"))
    nome = request.form.get("nome", "").strip()
    if codigo and nome:
        db = get_db()
        try:
            db.execute(
                "INSERT INTO fornecedores (codigo, nome) VALUES (?, ?)",
                (codigo, nome),
            )
            db.commit()
            flash("Fornecedor criado com sucesso.", "success")
        except Exception:
            flash("Erro: código de fornecedor já existe.", "error")
        db.close()
    return redirect(url_for("listar_fornecedores"))


@app.route("/fornecedor/<int:fornecedor_id>/excluir", methods=["POST"])
def fornecedor_excluir(fornecedor_id):
    db = get_db()
    db.execute("DELETE FROM fornecedores WHERE id = ?", (fornecedor_id,))
    db.commit()
    db.close()
    flash("Fornecedor excluído.", "success")
    return redirect(url_for("listar_fornecedores"))


# ── API for stock position ───────────────────────────────────────────────────


@app.route("/api/produto/<int:produto_id>/estoque", methods=["POST"])
def atualizar_estoque(produto_id):
    data = request.get_json()
    quantidade = parse_float(data.get("quantidade"), 0)
    operacao = data.get("operacao", "entrada")

    db = get_db()
    produto = db.execute(
        "SELECT posicao_estoque FROM produtos WHERE id = ?", (produto_id,)
    ).fetchone()

    if not produto:
        db.close()
        return jsonify({"error": "Produto não encontrado"}), 404

    estoque_atual = produto["posicao_estoque"] or 0
    if operacao == "entrada":
        novo_estoque = estoque_atual + quantidade
    else:
        novo_estoque = max(0, estoque_atual - quantidade)

    db.execute(
        "UPDATE produtos SET posicao_estoque = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?",
        (novo_estoque, produto_id),
    )
    db.commit()
    db.close()

    return jsonify({"posicao_estoque": novo_estoque})


if __name__ == "__main__":
    init_db()
    app.run(debug=True, host="0.0.0.0", port=5000)
