import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "farma.db")


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS grupos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            codigo INTEGER UNIQUE NOT NULL,
            nome TEXT NOT NULL
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS fornecedores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            codigo INTEGER UNIQUE NOT NULL,
            nome TEXT NOT NULL
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS produtos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            codigo INTEGER UNIQUE NOT NULL,
            descricao TEXT NOT NULL,
            grupo_id INTEGER,
            codigo_barras TEXT,

            -- Unidades
            unidade_manipulacao TEXT DEFAULT 'mg',
            unidade_estoque TEXT DEFAULT 'g',

            -- Custos e Preços
            valor_custo REAL DEFAULT 0,
            custo_medio REAL DEFAULT 0,
            custo_referencia REAL DEFAULT 0,
            markup REAL DEFAULT 0,
            valor_venda REAL DEFAULT 0,
            ocultar_venda INTEGER DEFAULT 0,

            -- Fatores
            fator_correcao REAL,
            fator_equivalencia REAL,
            densidade REAL DEFAULT 1,
            diluicao REAL DEFAULT 1,

            -- Estoque
            posicao_estoque REAL DEFAULT 0,
            estoque_minimo REAL DEFAULT 0,
            estoque_maximo REAL,

            -- Dose
            dose_maxima REAL,
            dose_maxima_um TEXT,
            dose_maxima_dia REAL,
            dose_maxima_dia_um TEXT,
            concentracao TEXT,

            -- Fornecedor
            fornecedor_id INTEGER,
            ultima_compra DATE,

            -- Cálculo
            tipo_calculo TEXT DEFAULT 'Percentual',
            margem_seguranca REAL,

            -- Classificação
            curva_abc TEXT DEFAULT 'A',
            sbit_rdc TEXT,

            -- Rótulo
            descricao_rotulo TEXT,
            cas TEXT,
            lista_controlado TEXT,
            dcb TEXT,
            dci TEXT,
            classe_terapeutica TEXT,
            antimicrobiano INTEGER DEFAULT 0,
            controle_especial INTEGER DEFAULT 0,
            uso_continuo INTEGER DEFAULT 0,

            -- Fiscal
            nbm_sh TEXT,
            ncm_sh TEXT,
            fabricante TEXT,
            num_licenca_mapa TEXT,

            -- Status
            inativo_compras INTEGER DEFAULT 0,
            produto_inativo INTEGER DEFAULT 0,

            -- Observações
            observacao TEXT,

            -- Timestamps
            criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
            atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP,

            FOREIGN KEY (grupo_id) REFERENCES grupos(id),
            FOREIGN KEY (fornecedor_id) REFERENCES fornecedores(id)
        )
    """)

    # Seed default groups
    grupos_default = [
        (10, "LÍQUIDOS"),
        (20, "CREMES"),
        (30, "CÁPSULAS"),
        (40, "SÓLIDOS"),
        (50, "EMBALAGENS"),
        (60, "MATÉRIA-PRIMA"),
        (70, "SEMI-ACABADOS"),
        (80, "HOMEOPÁTICOS"),
        (90, "FLORAIS"),
    ]
    for codigo, nome in grupos_default:
        cursor.execute(
            "INSERT OR IGNORE INTO grupos (codigo, nome) VALUES (?, ?)",
            (codigo, nome),
        )

    # Seed default suppliers
    fornecedores_default = [
        (1, "FAGRON"),
        (2, "DEG"),
        (3, "VIA FARMA"),
        (4, "ALL CHEMISTRY"),
        (5, "GALENA, QUIMICA E FARMAC."),
        (6, "GENIX"),
        (7, "IBEROQUÍMICA"),
        (8, "PHARMA NOSTRA"),
    ]
    for codigo, nome in fornecedores_default:
        cursor.execute(
            "INSERT OR IGNORE INTO fornecedores (codigo, nome) VALUES (?, ?)",
            (codigo, nome),
        )

    conn.commit()
    conn.close()


if __name__ == "__main__":
    init_db()
    print("Banco de dados inicializado com sucesso.")
