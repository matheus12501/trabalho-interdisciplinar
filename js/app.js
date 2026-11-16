/* =====================================================================
   BOMBOCLACT — front-end integrado à API C# e ao MySQL.

   Páginas HTML: index.html, produtos.html, sobre.html, contato.html, login.html, cadastro.html, perfil.html, carrinho.html, checkout.html e confirmacao.html

   Organização deste arquivo:
     1. Configuração e armazenamento   5. Telas (HTML de cada rota)
     2. API                            6. Ações (carrinho, login, pedido)
     3. Dados (produtos)               7. Renderização e rotas
     4. Utilitários e ícones           8. Eventos e inicialização

   CONTRATO COM A API (não alterar sem ajustar o back-end):
     GET  /api/produtos          -> [{ id, nome, descricao, preco, categoria, imagem }]
     POST /api/auth/login        { email, senha }            -> { token, usuario }
     POST /api/usuarios          { nome, email, senha }      -> { token, usuario }
     POST /api/auth/logout
     GET  /api/pedidos/me        -> [{ id, data, pagamento, total, status }]
     GET  /api/cupons            -> [{ codigo, condicoes, tipo, valor }]
     POST /api/pedidos           { itens:[{produtoId,quantidade}], formaPagamento,
                                   endereco:{rua,bairro,cidade,cep,complemento},
                                   codigoCupom, observacao }  -> { id, total, status }
   Chaves do localStorage: bc_api_url, bc_api_token, bc_current_user, bc_cart,
                           bc_orders_api, bc_cupons_api, bc_last_order, bc_return
   ===================================================================== */
'use strict';


/* ---------- 1. CONFIGURAÇÃO E ARMAZENAMENTO ---------- */
const PASTA_IMG = '../assets/';
const FORMAS_PAGAMENTO = ['Pix', 'Dinheiro', 'Cartão de crédito', 'Cartão de débito'];

/* O localStorage pode falhar (modo privado, bloqueio); estas funções nunca lançam erro. */
function lerTexto(chave) {
    try { return localStorage.getItem(chave); } catch { return null; }
}
function gravarTexto(chave, valor) {
    try { localStorage.setItem(chave, valor); } catch { /* sem armazenamento: segue sem salvar */ }
}
function removerChave(chave) {
    try { localStorage.removeItem(chave); } catch { /* idem */ }
}
function lerJSON(chave, padrao) {
    try {
        const valor = JSON.parse(localStorage.getItem(chave));
        return valor ?? padrao;
    } catch {
        return padrao;
    }
}
function gravarJSON(chave, valor) {
    gravarTexto(chave, JSON.stringify(valor));
}

const URL_API = lerTexto('bc_api_url') || (window.BC_CONFIG && window.BC_CONFIG.urlApi) || 'http://localhost:5080';

const obterToken = () => lerTexto('bc_api_token') || '';
const obterUsuario = () => (obterToken() ? lerJSON('bc_current_user', null) : null);
const obterCarrinho = () => lerJSON('bc_cart', []);
const contarItens = () => obterCarrinho().reduce((soma, item) => soma + item.qty, 0);


/* ---------- 2. API ---------- */
async function api(caminho, opcoes = {}) {
    const cabecalhos = { 'Content-Type': 'application/json', ...(opcoes.headers || {}) };
    const token = obterToken();
    if (token) cabecalhos.Authorization = 'Bearer ' + token;

    let resposta;
    try {
        resposta = await fetch(URL_API + caminho, { ...opcoes, headers: cabecalhos });
    } catch {
        throw new Error('Não foi possível comunicar com o servidor.');
    }

    const bruto = await resposta.text();
    let dados = {};
    try { dados = bruto ? JSON.parse(bruto) : {}; } catch { /* resposta sem JSON */ }

    if (!resposta.ok) {
        throw new Error(dados.message || dados.mensagem || dados.title || 'Não foi possível comunicar com o servidor.');
    }
    return dados;
}


/* ---------- 3. DADOS ---------- */
/* Cardápio local usado só enquanto a API não responde. Os nomes dos campos
   (id, name, description, price, category, image) são os mesmos guardados em bc_cart. */
let produtos = [
    { id: 1, name: 'Clássico BOMBOCLACT', description: 'Pão macio, hambúrguer artesanal, queijo, alface e molho especial.', price: 29.90, category: 'Clássicos', image: 'image 8.png' },
    { id: 2, name: 'Cheddar Bacon', description: 'Hambúrguer artesanal, cheddar cremoso e bacon crocante.', price: 34.90, category: 'Clássicos', image: 'image 10.png' },
    { id: 3, name: 'Duplo Sabor', description: 'Dois hambúrgueres, queijo derretido e molho da casa.', price: 39.90, category: 'Especiais', image: 'image 11.png' },
    { id: 4, name: 'Especial da Casa', description: 'Uma combinação caprichada de ingredientes selecionados.', price: 42.90, category: 'Especiais', image: 'image 12.png' },
    { id: 5, name: 'Burger Crocante', description: 'Hambúrguer suculento com uma textura irresistível.', price: 32.90, category: 'Clássicos', image: 'image 14.png' },
    { id: 6, name: 'Mega BOMBOCLACT', description: 'Uma opção generosa para quem está com muita fome.', price: 46.90, category: 'Especiais', image: 'image 15.png' }
];

const estado = {
    categoria: 'Todos',
    busca: '',
    etapa: 1,                 // etapa da finalização (1 entrega, 2 pagamento, 3 revisão)
    pagamento: 'Pix',
    endereco: null,
    codigoCupom: ''
};

async function carregarProdutosDaAPI() {
    try {
        const dados = await api('/api/produtos');
        if (!Array.isArray(dados)) return;
        produtos = dados.map(p => ({
            id: p.id,
            name: p.nome,
            description: p.descricao,
            price: Number(p.preco),
            category: p.categoria || 'Clássicos',
            image: p.imagem || 'image 8.png'
        }));
        atualizarVitrines();
    } catch (erro) {
        console.warn('API indisponível; mantendo o cardápio local temporário.', erro.message);
    }
}


/* ---------- 4. UTILITÁRIOS E ÍCONES ---------- */
const moeda = n => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/* Toda string vinda do servidor ou do usuário passa por aqui antes de entrar no HTML. */
function esc(texto) {
    return String(texto ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const img = nome => PASTA_IMG + encodeURI(nome);
function imgProduto(nome) {
    return /^(https?:)?\/\//.test(nome) ? nome : (nome.startsWith('assets/') ? '../' + nome : img(nome));
}

const ICONES = {
    seta: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    usuario: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'
};
const icone = nome => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONES[nome] || ''}</svg>`;

const el = id => document.getElementById(id);


/* ---------- 5. TELAS ---------- */

/* Peças reutilizáveis */
function htmlCartaoPrevia(p, i) {
    return `
        <a class="cp" href="produtos.html" style="--i:${i}" aria-label="Ver ${esc(p.name)} no cardápio">
            <span class="cp__foto"><img src="${esc(imgProduto(p.image))}" alt="" loading="lazy"></span>
            <span>
                <strong class="cp__nome">${esc(p.name)}</strong>
                <span class="cp__preco">${moeda(p.price)}</span>
            </span>
        </a>`;
}

function htmlProduto(p, i) {
    return `
        <article class="prd" style="--i:${i}">
            <div class="prd__foto"><img src="${esc(imgProduto(p.image))}" alt="${esc(p.name)}" loading="lazy"></div>
            <span class="prd__cat">${esc(p.category)}</span>
            <h3 class="prd__nome">${esc(p.name)}</h3>
            <p class="prd__desc">${esc(p.description)}</p>
            <div class="prd__rod">
                <span class="prd__preco">${moeda(p.price)}</span>
                <button class="bt bt--am bt--peq" type="button" data-acao="adicionar" data-id="${esc(p.id)}">Adicionar</button>
            </div>
        </article>`;
}

function htmlPedidos(pedidos) {
    return pedidos.map(o => `
        <div class="lin">
            <span>Pedido #${esc(o.id)} — ${esc(new Date(o.data).toLocaleString('pt-BR'))} — ${esc(o.pagamento || '')}</span>
            <strong>${moeda(o.total)} · ${esc(o.status)}</strong>
        </div>`).join('');
}

function htmlCupons(cupons) {
    return cupons.map(c => `
        <div class="lin">
            <span><strong>${esc(c.codigo)}</strong> — ${esc(c.condicoes || 'Cupom disponível')}</span>
            <strong>${c.tipo === 'percentual' ? Number(c.valor) + '%' : moeda(c.valor)}</strong>
        </div>`).join('');
}

/* INÍCIO */
function telaInicio() {
    const destaques = produtos.slice(0, 6);
    return `
        <section class="dest" aria-labelledby="t-dest">
            <img class="dest__gota" src="${img('Vector 1.png')}" alt="" width="1440" height="671">
            <img class="dest__burger" src="${img('image 7.png')}" width="489" height="704" fetchpriority="high"
                 alt="Hambúrguer artesanal com ingredientes suspensos no ar">
            <h1 class="dest__marca" id="t-dest">
                <img src="${img('BOMBOCLACT.png')}" alt="BOMBOCLACT" width="995" height="92">
            </h1>
            <p class="dest__txt">Hambúrguer feito para aproveitar. Escolha no cardápio e peça em poucos cliques.</p>
            <a class="bt bt--am" href="produtos.html">Ver cardápio ${icone('seta')}</a>
        </section>

        <div class="xdz" aria-hidden="true"></div>

        <section class="sec cdp" aria-labelledby="t-cdp">
            <div class="ctn">
                <header class="sec__cab apr">
                    <h2 id="t-cdp"><img class="tit-img" src="${img('Cardapio.png')}" alt="Cardápio" width="403" height="120"></h2>
                    <p class="intro">Os clássicos que nunca decepcionam e combinações para quem gosta de experimentar.</p>
                </header>

                <div class="cdp__corpo">
                    <div class="cdp__lista apr-gr apr" id="gr-previa">
                        ${destaques.map(htmlCartaoPrevia).join('')}
                    </div>
                    <img class="cdp__foto apr" src="${img('image 16.png')}" width="476" height="594" loading="lazy"
                         alt="Hambúrguer servido sobre caixas azuis empilhadas">
                </div>

                <div class="cdp__fim apr">
                    <a class="bt bt--am" href="produtos.html">Ver cardápio completo ${icone('seta')}</a>
                </div>
            </div>
        </section>

        <section class="sec sbr" aria-labelledby="t-sbr">
            <div class="ctn">
                <h2 class="apr" id="t-sbr"><img class="tit-img" src="${img('About.png')}" alt="Sobre nós" width="297" height="103"></h2>
                <div class="sbr__corpo apr">
                    <p>A BOMBOCLACT é uma hamburgueria dedicada a oferecer produtos de qualidade, com variedade, bom atendimento e praticidade.
                       Nosso objetivo é proporcionar uma ótima experiência aos clientes, garantindo sabor, satisfação e comodidade em cada pedido.</p>
                </div>
                <ul class="sbr__itens apr-gr apr">
                    <li style="--i:0"><strong>Qualidade</strong><span>Ingredientes bem escolhidos e preparo cuidadoso.</span></li>
                    <li style="--i:1"><strong>Variedade</strong><span>Opções para diferentes gostos, dos clássicos aos especiais.</span></li>
                    <li style="--i:2"><strong>Praticidade</strong><span>Escolha no site e faça o pedido em poucos passos.</span></li>
                </ul>
                <a class="bt bt--esc apr" href="sobre.html">Sobre nós ${icone('seta')}</a>
            </div>
        </section>`;
}

/* CARDÁPIO */
function categoriasDisponiveis() {
    return ['Todos', ...new Set(produtos.map(p => p.category))];
}
function produtosFiltrados() {
    const termo = estado.busca.trim().toLowerCase();
    return produtos.filter(p =>
        (estado.categoria === 'Todos' || p.category === estado.categoria) &&
        (p.name + ' ' + p.description).toLowerCase().includes(termo));
}
function htmlChips() {
    return categoriasDisponiveis().map(c =>
        `<button class="chp" type="button" data-acao="categoria" data-cat="${esc(c)}" aria-pressed="${estado.categoria === c}">${esc(c)}</button>`).join('');
}
function htmlGradeProdutos() {
    const lista = produtosFiltrados();
    return lista.length ? lista.map(htmlProduto).join('') : '<p class="vz-txt">Nenhum produto encontrado.</p>';
}
function textoQuantidade() {
    const n = produtosFiltrados().length;
    return `${n} ${n === 1 ? 'opção' : 'opções'}`;
}

function telaCardapio() {
    return `
        <section class="pag ctn">
            <header class="pag__cab pag__cab--centro apr">
                <p class="sobr">Feito para matar sua fome</p>
                <h1><img class="tit-img" src="${img('Cardapio.png')}" alt="Cardápio" width="403" height="120"></h1>
                <p class="intro">Escolha seu favorito e monte seu pedido.</p>
            </header>

            <div class="fil apr">
                <label class="fil__busca">
                    <span class="so-leitor">Buscar hambúrguer</span>
                    <input class="ent" type="search" placeholder="Buscar hambúrguer..." value="${esc(estado.busca)}" data-busca autocomplete="off">
                </label>
                <div class="fil__chips" id="chips" role="group" aria-label="Categorias">${htmlChips()}</div>
            </div>
            <p class="fil__qtd" id="qtd-res" aria-live="polite">${textoQuantidade()}</p>

            <div class="gr-prd apr-gr apr" id="gr-prd">${htmlGradeProdutos()}</div>
        </section>`;
}

/* SOBRE */
function telaSobre() {
    return `
        <section class="pag ctn">
            <header class="pag__cab pag__cab--centro apr">
                <p class="sobr">Nossa essência</p>
                <h1><img class="tit-img" src="${img('About.png')}" alt="Sobre a BOMBOCLACT" width="297" height="103"></h1>
            </header>

            <div class="sbr-pg">
                <div class="sbr-pg__txt apr">
                    <p class="dest-txt">Acreditamos que um bom hambúrguer transforma qualquer momento em uma experiência especial.</p>
                    <p>Nossa cozinha une ingredientes de qualidade, criatividade e cuidado em cada detalhe. Nascemos com a vontade de servir comida saborosa, sem complicação.</p>
                    <p>Do primeiro contato à última mordida, nosso compromisso é entregar uma experiência marcante.</p>
                    <ul class="sbr__itens">
                        <li><strong>Qualidade</strong><span>Ingredientes bem escolhidos e preparo cuidadoso.</span></li>
                        <li><strong>Variedade</strong><span>Opções para diferentes gostos, dos clássicos aos especiais.</span></li>
                        <li><strong>Praticidade</strong><span>Escolha no site e faça o pedido em poucos passos.</span></li>
                    </ul>
                    <a class="bt bt--am" href="produtos.html">Ver cardápio ${icone('seta')}</a>
                </div>
                <figure class="sbr-pg__foto apr" style="margin:0">
                    <img src="${img('image 16.png')}" width="476" height="594" alt="Hambúrguer servido sobre caixas azuis empilhadas">
                </figure>
            </div>
        </section>`;
}

/* CONTATO */
function telaContato() {
    return `
        <section class="pag ctn">
            <header class="pag__cab apr">
                <p class="sobr">Fale com a gente</p>
                <h1 class="tit">Contato</h1>
                <p class="intro" style="margin-top:12px">Dúvidas, sugestões ou elogios? Envie sua mensagem.</p>
            </header>

            <div class="ctt">
                <form class="pnl apr" data-form="contato" novalidate>
                    <div class="cmp"><label for="c-nome">Nome</label><input class="ent" id="c-nome" name="name" autocomplete="name" required minlength="2"></div>
                    <div class="cmp"><label for="c-email">E-mail</label><input class="ent" id="c-email" name="email" type="email" autocomplete="email" required></div>
                    <div class="cmp"><label for="c-assunto">Assunto</label><input class="ent" id="c-assunto" name="subject" required></div>
                    <div class="cmp"><label for="c-msg">Mensagem</label><textarea class="ent" id="c-msg" name="message" required minlength="10"></textarea></div>
                    <button class="bt bt--esc" type="submit">Enviar mensagem ${icone('seta')}</button>
                </form>

                <div class="ctt__info apr-gr apr">
                    <div class="ctt__item" style="--i:0"><strong>Endereço</strong><span>Belo Horizonte - MG</span></div>
                    <div class="ctt__item" style="--i:1"><strong>Telefone</strong><span><a href="tel:+553133330000">(31) 3333-0000</a></span></div>
                    <div class="ctt__item" style="--i:2"><strong>Horário</strong><span>Todos os dias, das 18h às 23h</span></div>
                </div>
            </div>
        </section>`;
}

/* LOGIN E CADASTRO */
function telaAutenticacao(cadastro = false) {
    return `
        <section class="pag ctn">
            <div class="aut">
                <header class="pag__cab pag__cab--centro">
                    <p class="sobr">${cadastro ? 'Faça parte' : 'Bem-vindo de volta'}</p>
                    <h1 class="tit">${cadastro ? 'Criar conta' : 'Entrar'}</h1>
                </header>
                <div class="pnl apr">
                    <form data-form="${cadastro ? 'cadastro' : 'login'}">
                        ${cadastro ? '<div class="cmp"><label for="a-nome">Nome completo</label><input class="ent" id="a-nome" name="name" autocomplete="name" required minlength="3"></div>' : ''}
                        <div class="cmp"><label for="a-email">E-mail</label><input class="ent" id="a-email" name="email" type="email" autocomplete="email" required></div>
                        <div class="cmp"><label for="a-senha">Senha</label><input class="ent" id="a-senha" name="password" type="password" autocomplete="${cadastro ? 'new-password' : 'current-password'}" required minlength="6"></div>
                        ${cadastro ? '<div class="cmp"><label for="a-conf">Confirmar senha</label><input class="ent" id="a-conf" name="confirm" type="password" autocomplete="new-password" required minlength="6"></div>' : ''}
                        <button class="bt bt--esc bt--total" type="submit">${cadastro ? 'Criar conta' : 'Entrar'}</button>
                    </form>
                    <p class="aut__troca">
                        ${cadastro ? 'Já possui conta?' : 'Ainda não tem conta?'}
                        <a class="lnk" href="${cadastro ? 'login.html' : 'cadastro.html'}">${cadastro ? 'Fazer login' : 'Criar conta'}</a>
                    </p>
                    <p class="nota">Seus dados de acesso são verificados com segurança no servidor da BOMBOCLACT.</p>
                </div>
            </div>
        </section>`;
}

/* PERFIL */
function telaPerfil() {
    const usuario = obterUsuario();
    if (!usuario) return telaAutenticacao();

    const pedidos = lerJSON('bc_orders_api', []);
    const cupons = lerJSON('bc_cupons_api', []);
    return `
        <section class="pag ctn">
            <header class="pag__cab apr">
                <p class="sobr">Área do cliente</p>
                <h1 class="tit">Olá, ${esc(String(usuario.name || '').split(' ')[0])}</h1>
                <p class="intro" style="margin-top:12px">Seus pedidos são consultados diretamente na sua conta.</p>
            </header>

            <div class="pnl apr">
                <div class="per__bloco">
                    <h2>Meus pedidos</h2>
                    <div id="ped-lista">${pedidos.length ? htmlPedidos(pedidos) : '<p>Carregando seus pedidos...</p>'}</div>
                </div>
                <div class="per__bloco">
                    <h2>Cupons disponíveis</h2>
                    <div id="cup-lista">${cupons.length ? htmlCupons(cupons) : '<p>Consultando seus cupons...</p>'}</div>
                </div>
                <button class="bt bt--cont per__sair" type="button" data-acao="sair">Sair da conta</button>
            </div>
        </section>`;
}

/* CARRINHO */
function telaCarrinho() {
    const itens = obterCarrinho();
    if (!itens.length) {
        return `
            <section class="pag ctn">
                <div class="pnl vz apr" style="max-width:560px;margin-inline:auto">
                    <h2>Seu carrinho está vazio</h2>
                    <p>Escolha um lanche no cardápio e ele aparece aqui.</p>
                    <a class="bt bt--esc" href="produtos.html">Ir para o cardápio ${icone('seta')}</a>
                </div>
            </section>`;
    }

    const subtotal = itens.reduce((soma, i) => soma + i.price * i.qty, 0);
    return `
        <section class="pag ctn">
            <header class="pag__cab apr">
                <p class="sobr">Seu pedido</p>
                <h1 class="tit">Carrinho</h1>
            </header>

            <div class="crr">
                <section class="pnl apr" aria-label="Itens do carrinho">
                    ${itens.map(i => `
                        <div class="crr__item">
                            <div class="crr__foto"><img src="${esc(imgProduto(i.image))}" alt="${esc(i.name)}"></div>
                            <div>
                                <h3 class="crr__nome">${esc(i.name)}</h3>
                                <p class="crr__un">${moeda(i.price)} cada</p>
                            </div>
                            <div class="crr__acoes">
                                <div class="qtd">
                                    <button type="button" data-acao="menos" data-id="${esc(i.id)}" aria-label="Diminuir quantidade de ${esc(i.name)}">−</button>
                                    <output aria-live="polite">${i.qty}</output>
                                    <button type="button" data-acao="mais" data-id="${esc(i.id)}" aria-label="Aumentar quantidade de ${esc(i.name)}">+</button>
                                </div>
                                <button class="crr__remover" type="button" data-acao="remover" data-id="${esc(i.id)}">Remover</button>
                            </div>
                            <strong class="crr__total">${moeda(i.price * i.qty)}</strong>
                        </div>`).join('')}
                </section>

                <aside class="pnl res apr">
                    <h2>Resumo do pedido</h2>
                    <div class="lin lin--total"><span>Total</span><strong>${moeda(subtotal)}</strong></div>
                    <button class="bt bt--esc bt--total" type="button" data-acao="finalizar" style="margin-top:18px">Avançar com a compra ${icone('seta')}</button>
                    <a class="res__cont" href="produtos.html">Continuar comprando</a>
                </aside>
            </div>
        </section>`;
}

/* FINALIZAÇÃO */
function telaFinalizacao() {
    if (!obterUsuario()) return telaAutenticacao();

    const itens = obterCarrinho();
    if (!itens.length) {
        return `
            <section class="pag ctn">
                <div class="pnl vz apr" style="max-width:560px;margin-inline:auto">
                    <h2>Nenhum item para finalizar</h2>
                    <p>Adicione um lanche ao carrinho para continuar.</p>
                    <a class="bt bt--esc" href="produtos.html">Voltar ao cardápio</a>
                </div>
            </section>`;
    }

    if (estado.etapa === 3 && !estado.endereco) estado.etapa = 1;
    const total = itens.reduce((soma, i) => soma + i.price * i.qty, 0);
    const e = estado.endereco || {};
    const etapas = ['Entrega', 'Pagamento', 'Revisão'];

    let corpo;
    if (estado.etapa === 1) {
        corpo = `
            <h2>Endereço de entrega</h2>
            <form data-form="entrega">
                <div class="gr-cmp">
                    <div class="cmp cmp--cheio"><label for="f-rua">Rua e número</label><input class="ent" id="f-rua" name="street" autocomplete="street-address" required value="${esc(e.street)}"></div>
                    <div class="cmp"><label for="f-bairro">Bairro</label><input class="ent" id="f-bairro" name="district" required value="${esc(e.district)}"></div>
                    <div class="cmp"><label for="f-cidade">Cidade</label><input class="ent" id="f-cidade" name="city" autocomplete="address-level2" required value="${esc(e.city)}"></div>
                    <div class="cmp"><label for="f-cep">CEP</label><input class="ent" id="f-cep" name="zip" autocomplete="postal-code" inputmode="numeric" required value="${esc(e.zip)}"></div>
                    <div class="cmp"><label for="f-comp">Complemento</label><input class="ent" id="f-comp" name="complement" value="${esc(e.complement)}"></div>
                </div>
                <button class="bt bt--esc" type="submit">Continuar ${icone('seta')}</button>
            </form>`;
    } else if (estado.etapa === 2) {
        corpo = `
            <h2>Forma de pagamento</h2>
            <form data-form="pagamento">
                <div class="pg" role="radiogroup" aria-label="Forma de pagamento">
                    ${FORMAS_PAGAMENTO.map(f => `
                        <label><input type="radio" name="payment" value="${esc(f)}" ${estado.pagamento === f ? 'checked' : ''}><span>${esc(f)}</span></label>`).join('')}
                </div>
                <div class="fin__acoes">
                    <button class="bt bt--esc" type="submit">Revisar pedido ${icone('seta')}</button>
                    <button class="bt bt--cont" type="button" data-acao="etapa" data-etapa="1">Voltar</button>
                </div>
            </form>`;
    } else {
        corpo = `
            <h2>Revise seu pedido</h2>
            <div class="lin"><span>Entrega</span><strong>${esc(e.street)}, ${esc(e.district)} — ${esc(e.city)}</strong></div>
            <div class="lin"><span>Pagamento</span><strong>${esc(estado.pagamento)}</strong></div>
            ${itens.map(i => `<div class="lin"><span>${i.qty}x ${esc(i.name)}</span><strong>${moeda(i.qty * i.price)}</strong></div>`).join('')}
            <div class="lin"><span>Subtotal dos produtos</span><strong>${moeda(total)}</strong></div>
            <div class="cmp" style="margin-top:16px"><label for="f-cupom">Cupom de desconto (opcional)</label><input class="ent" id="f-cupom" name="cupom" maxlength="40" placeholder="Digite seu cupom" value="${esc(estado.codigoCupom || '')}"></div>
            <p class="nota">A taxa de entrega e o desconto do cupom serão calculados e confirmados pelo servidor antes de registrar o pedido. Taxa de entrega atual: R$ 5,00.</p>
            <p class="nota">O pedido será enviado com segurança para a hamburgueria. O pagamento será realizado conforme a opção escolhida.</p>
            <div class="fin__acoes" style="margin-top:20px">
                <button class="bt bt--esc" type="button" data-acao="confirmar">Confirmar pedido ${icone('seta')}</button>
                <button class="bt bt--cont" type="button" data-acao="etapa" data-etapa="2">Voltar</button>
            </div>`;
    }

    return `
        <section class="pag ctn">
            <div class="fin">
                <header class="pag__cab apr">
                    <p class="sobr">Falta pouco</p>
                    <h1 class="tit">Finalizar compra</h1>
                </header>
                <ol class="etp" aria-label="Etapas da compra">
                    ${etapas.map((nome, i) => `<li class="${estado.etapa > i + 1 ? 'ok' : ''}" ${estado.etapa === i + 1 ? 'aria-current="step"' : ''}>${i + 1}. ${nome}</li>`).join('')}
                </ol>
                <div class="pnl apr">${corpo}</div>
            </div>
        </section>`;
}

/* CONFIRMAÇÃO */
function telaConfirmacao() {
    const pedido = lerJSON('bc_last_order', null);
    if (!pedido) return telaCarrinho();
    return `
        <section class="pag ctn">
            <div class="pnl conf">
                <div class="conf__marca">${icone('check')}</div>
                <p class="sobr" style="color:var(--azul)">Pedido registrado</p>
                <h1 class="tit">Obrigado!</h1>
                <p>Seu pedido <strong>#${esc(pedido.id)}</strong> foi registrado no sistema da BOMBOCLACT.</p>
                <p>Total: <strong>${moeda(pedido.total)}</strong></p>
                <a class="bt bt--esc" href="perfil.html">Ver meus pedidos ${icone('seta')}</a>
            </div>
        </section>`;
}


/* ---------- 6. AÇÕES ---------- */

/* Carrinho */
function adicionarAoCarrinho(id) {
    const produto = produtos.find(p => String(p.id) === String(id));
    if (!produto) return;
    const carrinho = obterCarrinho();
    const existente = carrinho.find(i => String(i.id) === String(id));
    if (existente) existente.qty++;
    else carrinho.push({ ...produto, qty: 1 });
    gravarJSON('bc_cart', carrinho);
    atualizarCabecalho(true);
    aviso(`${produto.name} adicionado ao carrinho.`);
}

function alterarQuantidade(id, delta) {
    const carrinho = obterCarrinho();
    const item = carrinho.find(i => String(i.id) === String(id));
    if (item) item.qty += delta;
    gravarJSON('bc_cart', carrinho.filter(i => i.qty > 0));
    renderizar({ rolar: false, animar: false });
}

function removerDoCarrinho(id) {
    gravarJSON('bc_cart', obterCarrinho().filter(i => String(i.id) !== String(id)));
    renderizar({ rolar: false, animar: false });
    aviso('Item removido.');
}

function irParaFinalizacao() {
    estado.etapa = 1;
    if (!obterUsuario()) {
        gravarJSON('bc_return', 'checkout');
        irPara('login');
    } else {
        irPara('checkout');
    }
}

/* Sessão */
function iniciarSessao(resultado) {
    gravarTexto('bc_api_token', resultado.token);
    gravarJSON('bc_current_user', {
        id: resultado.usuario.id,
        name: resultado.usuario.nome,
        email: resultado.usuario.email,
        papel: resultado.usuario.papel,
        address: {}
    });
}

async function entrar(form) {
    const dados = new FormData(form);
    try {
        const resultado = await api('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email: dados.get('email'), senha: dados.get('password') })
        });
        iniciarSessao(resultado);
        const destino = lerJSON('bc_return', 'profile');
        removerChave('bc_return');
        await carregarMeusPedidos();
        irPara(destino.replace(/^#\//, ''));
        aviso('Login realizado com sucesso.');
    } catch (erro) {
        aviso(erro.message || 'E-mail ou senha incorretos.', true);
    }
}

async function cadastrar(form) {
    const dados = new FormData(form);
    if (dados.get('password') !== dados.get('confirm')) return aviso('As senhas não coincidem.', true);
    try {
        const resultado = await api('/api/usuarios', {
            method: 'POST',
            body: JSON.stringify({ nome: dados.get('name'), email: dados.get('email'), senha: dados.get('password') })
        });
        iniciarSessao(resultado);
        irPara('profile');
        aviso('Conta criada com sucesso.');
    } catch (erro) {
        aviso(erro.message, true);
    }
}

async function sair() {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* sai mesmo sem resposta */ }
    removerChave('bc_api_token');
    removerChave('bc_current_user');
    irPara('home');
    aviso('Você saiu da sua conta.');
}

async function carregarMeusPedidos() {
    if (!obterToken()) return;
    try {
        const [pedidos, cupons] = await Promise.all([api('/api/pedidos/me'), api('/api/cupons')]);
        gravarJSON('bc_orders_api', pedidos);
        gravarJSON('bc_cupons_api', cupons);

        if (rotaAtiva === 'profile') {
            const areaPedidos = el('ped-lista');
            const areaCupons = el('cup-lista');
            if (areaPedidos) areaPedidos.innerHTML = pedidos.length ? htmlPedidos(pedidos) : '<p>Você ainda não fez pedidos.</p>';
            if (areaCupons) areaCupons.innerHTML = cupons.length ? htmlCupons(cupons) : '<p>Nenhum cupom disponível no momento.</p>';
        }
    } catch (erro) {
        aviso(erro.message, true);
    }
}

/* Finalização */
function guardarEntrega(form) {
    const d = new FormData(form);
    estado.endereco = { street: d.get('street'), district: d.get('district'), city: d.get('city'), zip: d.get('zip'), complement: d.get('complement') };
    estado.etapa = 2;
    renderizar();
}

function guardarPagamento(form) {
    estado.pagamento = new FormData(form).get('payment') || 'Pix';
    estado.etapa = 3;
    renderizar();
}

async function confirmarPedido() {
    const itens = obterCarrinho();
    if (!itens.length) return aviso('Seu carrinho está vazio.', true);

    const dados = {
        itens: itens.map(i => ({ produtoId: Number(i.id), quantidade: Number(i.qty) })),
        formaPagamento: estado.pagamento,
        endereco: {
            rua: estado.endereco.street,
            bairro: estado.endereco.district,
            cidade: estado.endereco.city,
            cep: estado.endereco.zip,
            complemento: estado.endereco.complement
        },
        codigoCupom: (document.getElementById('f-cupom')?.value || '').trim() || null,
        observacao: ''
    };

    try {
        const resultado = await api('/api/pedidos', { method: 'POST', body: JSON.stringify(dados) });
        gravarJSON('bc_last_order', { id: resultado.id, subtotal: Number(resultado.subtotal), desconto: Number(resultado.desconto), taxaEntrega: Number(resultado.taxaEntrega), codigoCupom: resultado.codigoCupom || '', total: Number(resultado.total), status: resultado.status });
        gravarJSON('bc_cart', []);
        estado.etapa = 1;
        irPara('confirmation');
        aviso('Pedido enviado para a hamburgueria!');
    } catch (erro) {
        aviso(erro.message, true);
    }
}

function enviarContato(form) {
    form.reset();
    aviso('Mensagem registrada apenas nesta demonstração.');
}

/* Avisos (toasts) */
function aviso(mensagem, erro = false) {
    const caixa = document.createElement('div');
    caixa.className = 'avs' + (erro ? ' avs--erro' : '');
    caixa.textContent = mensagem;
    el('avisos').appendChild(caixa);
    setTimeout(() => {
        caixa.classList.add('saindo');
        setTimeout(() => caixa.remove(), 300);
    }, 3200);
}


/* ---------- 7. PÁGINAS HTML E RENDERIZAÇÃO ---------- */
const PAGINAS = {
    home: { arquivo: 'index.html', tela: telaInicio, titulo: 'BOMBOCLACT | Hamburgueria' },
    menu: { arquivo: 'produtos.html', tela: telaCardapio, titulo: 'Cardápio | BOMBOCLACT' },
    about: { arquivo: 'sobre.html', tela: telaSobre, titulo: 'Sobre nós | BOMBOCLACT' },
    contact: { arquivo: 'contato.html', tela: telaContato, titulo: 'Contato | BOMBOCLACT' },
    login: { arquivo: 'login.html', tela: () => telaAutenticacao(false), titulo: 'Entrar | BOMBOCLACT' },
    register: { arquivo: 'cadastro.html', tela: () => telaAutenticacao(true), titulo: 'Criar conta | BOMBOCLACT' },
    profile: { arquivo: 'perfil.html', tela: telaPerfil, titulo: 'Minha conta | BOMBOCLACT' },
    cart: { arquivo: 'carrinho.html', tela: telaCarrinho, titulo: 'Carrinho | BOMBOCLACT' },
    checkout: { arquivo: 'checkout.html', tela: telaFinalizacao, titulo: 'Finalizar compra | BOMBOCLACT' },
    confirmation: { arquivo: 'confirmacao.html', tela: telaConfirmacao, titulo: 'Pedido confirmado | BOMBOCLACT' }
};

let rotaAtiva = 'home';

function paginaAtual() {
    const nome = el('cnt').dataset.pagina || 'home';
    return PAGINAS[nome] ? nome : 'home';
}

/* A navegação troca para outro arquivo HTML; não utiliza rotas com #/. */
function irPara(pagina) {
    const destino = PAGINAS[pagina] ? PAGINAS[pagina].arquivo : pagina;
    if (destino === location.pathname.split('/').pop()) {
        renderizar();
        return;
    }
    location.href = destino;
}

function renderizar({ rolar = true, foco = false, animar = true } = {}) {
    rotaAtiva = paginaAtual();
    const pagina = PAGINAS[rotaAtiva];
    el('cnt').innerHTML = `<div class="tela${animar ? '' : ' sem-anim'}">${pagina.tela()}</div>`;
    document.title = pagina.titulo;

    atualizarCabecalho();
    fecharMenu();
    if (!animar) el('cnt').querySelectorAll('.apr').forEach(a => a.classList.add('vis'));
    observarEntrada();
    if (rolar) window.scrollTo(0, 0);
    if (foco) el('cnt').focus({ preventScroll: true });
    if (rotaAtiva === 'profile' && obterToken()) carregarMeusPedidos();
}

/* Atualiza só as listas de produtos (quando a API responde ou o filtro muda), sem refazer a página. */
function atualizarVitrines() {
    const previa = el('gr-previa');
    if (previa) previa.innerHTML = produtos.slice(0, 6).map(htmlCartaoPrevia).join('');
    atualizarGradeCardapio();
}

function atualizarGradeCardapio() {
    const grade = el('gr-prd');
    if (!grade) return;
    grade.innerHTML = htmlGradeProdutos();
    el('chips').innerHTML = htmlChips();
    el('qtd-res').textContent = textoQuantidade();
}

function atualizarCabecalho(pulsar = false) {
    const qtd = contarItens();
    const selo = el('qtd-carrinho');
    selo.textContent = qtd;
    selo.hidden = qtd === 0;
    if (pulsar) {
        selo.classList.remove('pulsar');
        void selo.offsetWidth;            // reinicia a animação
        selo.classList.add('pulsar');
    }

    const usuario = obterUsuario();
    const perfil = el('btn-perfil');
    perfil.href = usuario ? 'perfil.html' : 'login.html';
    perfil.setAttribute('aria-label', usuario ? 'Minha conta' : 'Acessar minha conta');
    perfil.innerHTML = usuario && usuario.name ? esc(String(usuario.name).trim().charAt(0).toUpperCase()) : icone('usuario');

    document.querySelectorAll('#nav a').forEach(a => {
        if (a.dataset.rota === rotaAtiva) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
    });
}

/* Menu do celular */
function alternarMenu(forcar) {
    const cab = el('cab');
    const abrir = typeof forcar === 'boolean' ? forcar : !cab.classList.contains('aberto');
    cab.classList.toggle('aberto', abrir);
    const botao = cab.querySelector('.cab__menu');
    botao.setAttribute('aria-expanded', String(abrir));
    botao.setAttribute('aria-label', abrir ? 'Fechar menu' : 'Abrir menu');
}
const fecharMenu = () => alternarMenu(false);

/* Animação de entrada: elementos .apr ganham .vis ao aparecer na tela. */
let observador = null;
function observarEntrada() {
    const alvos = document.querySelectorAll('.apr:not(.vis)');
    if (!('IntersectionObserver' in window)) {
        alvos.forEach(a => a.classList.add('vis'));
        return;
    }
    if (observador) observador.disconnect();
    observador = new IntersectionObserver(entradas => {
        entradas.forEach(e => {
            if (e.isIntersecting) {
                e.target.classList.add('vis');
                observador.unobserve(e.target);
            }
        });
    }, { threshold: .12, rootMargin: '0px 0px -40px 0px' });
    alvos.forEach(a => observador.observe(a));
}


/* ---------- 8. EVENTOS E INICIALIZAÇÃO ---------- */
document.addEventListener('click', ev => {
    const alvo = ev.target.closest('[data-acao]');

    /* Clique fora do cabeçalho fecha o menu do celular. */
    if (!ev.target.closest('#cab')) fecharMenu();
    if (!alvo) return;

    const { acao, id, cat, etapa } = alvo.dataset;
    switch (acao) {
        case 'menu': alternarMenu(); break;
        case 'adicionar': adicionarAoCarrinho(id); break;
        case 'mais': alterarQuantidade(id, 1); break;
        case 'menos': alterarQuantidade(id, -1); break;
        case 'remover': removerDoCarrinho(id); break;
        case 'finalizar': irParaFinalizacao(); break;
        case 'sair': sair(); break;
        case 'categoria': estado.categoria = cat; atualizarGradeCardapio(); break;
        case 'etapa': estado.etapa = Number(etapa); renderizar({ rolar: false }); break;
        case 'confirmar': travar(alvo, confirmarPedido); break;
    }
});

document.addEventListener('submit', ev => {
    const form = ev.target.closest('form[data-form]');
    if (!form) return;
    ev.preventDefault();
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }
    const botao = form.querySelector('[type="submit"]');
    const acoes = {
        login: () => entrar(form),
        cadastro: () => cadastrar(form),
        contato: () => enviarContato(form),
        entrega: () => guardarEntrega(form),
        pagamento: () => guardarPagamento(form)
    };
    const acao = acoes[form.dataset.form];
    if (acao) travar(botao, acao);
});

document.addEventListener('input', ev => {
    if (ev.target.matches('[data-busca]')) {
        estado.busca = ev.target.value;
        atualizarGradeCardapio();
    }
});

document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') fecharMenu();
});

/* Desativa o botão enquanto a ação roda, evitando cliques duplos (ex.: pedido enviado duas vezes). */
async function travar(botao, acao) {
    if (botao) botao.disabled = true;
    try { await acao(); }
    finally { if (botao && botao.isConnected) botao.disabled = false; }
}

el('ano').textContent = new Date().getFullYear();
renderizar();
carregarProdutosDaAPI();
