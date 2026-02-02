/* === UTILS === */
const Utils = {
    fmtMoney: (v) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(v),
    fmtDate: (d) => d ? new Date(d).toLocaleDateString('it-IT', {day:'2-digit', month:'2-digit', year:'numeric'}) : 'N/D',
    genId: () => Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
    today: () => new Date().toISOString().split('T')[0],
    addMonths: (d, m) => { 
        let x = new Date(d); 
        // Protezione date invalide
        if(isNaN(x.getTime())) return Utils.today(); 
        x.setMonth(x.getMonth() + parseInt(m)); 
        return x.toISOString().split('T')[0]; 
    }
};

/* === STORE === */
const Store = {
    data: { 
        pin: null, 
        accounts: [], 
        transactions: [], 
        recurring: [], 
        categories: ['Alimentari', 'Casa', 'Trasporti', 'Svago', 'Salute', 'Shopping', 'Ristoranti', 'Stipendio', 'Altro'], 
        settings: { theme: 'light' } 
    },

    init() {
        const s = localStorage.getItem('LUMO_V3');
        if (s) {
            try { 
                this.data = JSON.parse(s);
                // Fix compatibilità
                if(!this.data.categories) this.data.categories = ['Alimentari', 'Casa', 'Trasporti', 'Svago', 'Salute', 'Shopping', 'Altro'];
            } catch (e) { console.error(e); }
        } else {
            this.data.accounts = [{ id: 'a1', name: 'Conto Corrente', type: 'bank', balance: 0 }];
            this.save();
        }
        this.applyTheme();
        this.checkRecurring();
    },

    save() { localStorage.setItem('LUMO_V3', JSON.stringify(this.data)); },

    /* -- CRUD -- */
    saveAccount(acc) {
        const idx = this.data.accounts.findIndex(a => a.id === acc.id);
        if (idx > -1) this.data.accounts[idx] = acc; else this.data.accounts.push(acc);
        this.save();
    },
    deleteAccount(id) {
        this.data.accounts = this.data.accounts.filter(a => a.id !== id);
        this.data.transactions = this.data.transactions.filter(t => t.accountId !== id && t.fromAccount !== id && t.toAccount !== id);
        this.data.recurring = this.data.recurring.filter(r => r.accountId !== id);
        this.save();
    },

    saveTransaction(tx) {
        const oldIdx = this.data.transactions.findIndex(t => t.id === tx.id);
        if (oldIdx > -1) {
            this.revertBalance(this.data.transactions[oldIdx]);
            this.data.transactions[oldIdx] = tx;
        } else {
            // Rateizzazioni
            if (tx.installments > 1 && tx.type === 'expense') {
                const baseAmt = tx.amount / tx.installments;
                const baseDate = new Date(tx.date);
                for (let i = 0; i < tx.installments; i++) {
                    const nextD = new Date(baseDate); nextD.setMonth(baseDate.getMonth() + i);
                    const newTx = { ...tx, id: (i===0?tx.id:Utils.genId()), amount: baseAmt, date: nextD.toISOString().split('T')[0], desc: `${tx.desc} (${i+1}/${tx.installments})`, installments: 1 };
                    this.data.transactions.push(newTx);
                    this.applyBalance(newTx);
                }
                this.save(); return;
            }
            this.data.transactions.push(tx);
        }
        this.applyBalance(tx);
        this.save();
    },
    deleteTransaction(id) {
        const idx = this.data.transactions.findIndex(t => t.id === id);
        if (idx > -1) { this.revertBalance(this.data.transactions[idx]); this.data.transactions.splice(idx, 1); this.save(); }
    },

    saveRecurring(rec) {
        const idx = this.data.recurring.findIndex(r => r.id === rec.id);
        if (idx > -1) this.data.recurring[idx] = rec; else this.data.recurring.push(rec);
        this.save();
        this.checkRecurring(); // Ricontrolla subito
    },
    deleteRecurring(id) {
        this.data.recurring = this.data.recurring.filter(r => r.id !== id);
        this.save();
    },

    /* -- CATEGORIE -- */
    addCategory(n) { if(!this.data.categories.includes(n)) { this.data.categories.push(n); this.save(); } },
    updateCategory(o, n) { 
        const i = this.data.categories.indexOf(o); 
        if(i>-1) { this.data.categories[i]=n; this.data.transactions.forEach(t=>{if(t.category===o)t.category=n}); this.data.recurring.forEach(r=>{if(r.category===o)r.category=n}); this.save(); }
    },
    deleteCategory(n) { 
        this.data.categories = this.data.categories.filter(c=>c!==n); 
        this.data.transactions.forEach(t=>{if(t.category===n)t.category='Altro'}); this.save(); 
    },

    /* -- SALDI -- */
    updateAccBal(id, amt, type, rev=false) {
        const acc = this.data.accounts.find(a => a.id === id);
        if(!acc) return;
        let v = parseFloat(amt); if(rev) v = -v;
        if(type === 'income') acc.balance += v; else acc.balance -= v;
    },
    applyBalance(tx) {
        if(tx.type==='transfer') { this.updateAccBal(tx.fromAccount,tx.amount,'expense'); this.updateAccBal(tx.toAccount,tx.amount,'income'); }
        else this.updateAccBal(tx.accountId,tx.amount,tx.type);
    },
    revertBalance(tx) {
        if(tx.type==='transfer') { this.updateAccBal(tx.fromAccount,tx.amount,'expense',true); this.updateAccBal(tx.toAccount,tx.amount,'income',true); }
        else this.updateAccBal(tx.accountId,tx.amount,tx.type,true);
    },

    /* -- LOGICA CORE SCADENZE -- */
    checkRecurring() {
        const today = Utils.today();
        let changed = false;
        
        this.data.recurring.forEach(r => {
            if (!r.active) return;
            
            // PROTEZIONE: Frequenza minima 1 mese
            if(!r.freq || r.freq < 1) r.freq = 1;
            
            // PROTEZIONE: Se la data è invalida, non fare nulla
            if(!r.nextDate || isNaN(new Date(r.nextDate).getTime())) return;

            let safety = 0;
            // Esegue SOLO se la data è OGGI o PASSATA (<= today)
            // Se è FUTURA, il while non parte e non genera nulla.
            while (r.nextDate <= today && safety < 12) {
                const tx = {
                    id: Utils.genId(),
                    type: r.type,
                    amount: parseFloat(r.amount),
                    desc: r.desc + ' (Fissa)',
                    category: r.category,
                    accountId: r.accountId,
                    date: r.nextDate,
                    installments: 1
                };
                
                this.data.transactions.push(tx);
                this.applyBalance(tx);
                
                // Avanza data
                r.nextDate = Utils.addMonths(r.nextDate, parseInt(r.freq));
                changed = true;
                safety++;
            }
        });

        if(changed) this.save();
    },

    applyTheme() { document.body.setAttribute('data-theme', this.data.settings.theme); }
};

/* === UI === */
const UI = {
    render() {
        const p = Router.page;
        if(p==='dashboard') this.drawDash();
        else if(p==='transactions') this.drawTxList();
        else if(p==='accounts') this.drawAccounts();
        else if(p==='recurring') this.drawRecurring();
    },

    /* -- DASH -- */
    drawDash() {
        const total = Store.data.accounts.reduce((s,a) => s + a.balance, 0);
        const stats = this.calcStats();
        
        let accHtml = '';
        Store.data.accounts.forEach(a => {
            accHtml += `<div style="display:flex; justify-content:space-between; padding:10px 0; border-bottom:1px solid var(--border)">
                <div style="font-size:0.9rem; font-weight:600">${a.name}</div>
                <div style="font-weight:700; color:${a.balance>=0?'var(--text-main)':'var(--danger)'}">${Utils.fmtMoney(a.balance)}</div>
            </div>`;
        });
        
        document.getElementById('main-content').innerHTML = `
            <div class="balance-card">
                <p style="opacity:0.8; font-size:0.9rem; text-transform:uppercase;">Patrimonio Netto</p>
                <h2>${Utils.fmtMoney(total)}</h2>
            </div>
            <div class="card" style="padding-top:10px; padding-bottom:10px">${accHtml}</div>
            <div class="summary-grid">
                <div class="card"><p>Entrate</p><span class="amount pos" style="font-size:1.3rem">+${Utils.fmtMoney(stats.inc)}</span></div>
                <div class="card"><p>Uscite</p><span class="amount neg" style="font-size:1.3rem; color:var(--danger)">-${Utils.fmtMoney(stats.exp)}</span></div>
            </div>
            <div class="card"><h3 style="margin-bottom:15px">Spese Mensili</h3><div style="height:220px"><canvas id="chart"></canvas></div></div>
            <div class="card"><h3>Recenti</h3><div id="mini-list"></div></div>
        `;
        this.drawList(Store.data.transactions.slice().sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,5), 'mini-list');
        this.drawChart(stats.cats);
    },

    /* -- LISTE -- */
    drawTxList() {
        const all = [...Store.data.transactions].sort((a,b) => new Date(b.date) - new Date(a.date));
        document.getElementById('main-content').innerHTML = `
            <div class="card" style="position:sticky; top:0; z-index:10; padding:15px;">
                <input type="text" id="search" placeholder="🔍 Cerca..." onkeyup="UI.render()" style="padding:12px; width:100%; border-radius:12px; border:1px solid var(--border)">
            </div>
            <div class="card" style="padding-top:0"><div id="full-list"></div></div>
        `;
        const q = document.getElementById('search') ? document.getElementById('search').value.toLowerCase() : '';
        const filt = all.filter(t => t.desc.toLowerCase().includes(q) || t.category.toLowerCase().includes(q));
        this.drawList(filt, 'full-list');
    },
    drawList(list, id) {
        const el = document.getElementById(id);
        if(!list.length) { el.innerHTML='<div style="padding:20px; text-align:center; opacity:0.5">Nessun dato</div>'; return; }
        el.innerHTML = list.map(t => `
            <div class="list-item" onclick="UI.modalTx('${t.id}')">
                <div style="display:flex; align-items:center; overflow:hidden">
                    <div class="icon-box">${t.type==='expense'?'📉':(t.type==='transfer'?'↔️':'📈')}</div>
                    <div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-right:10px">
                        <div style="font-weight:700">${t.desc}</div>
                        <div style="font-size:0.8rem; opacity:0.7">${Utils.fmtDate(t.date)} • ${t.category}</div>
                    </div>
                </div>
                <div class="amount ${t.type==='expense'?'neg':(t.type==='income'?'pos':'')}">
                    ${t.type==='expense'?'-':(t.type==='income'?'+':'')}${Utils.fmtMoney(t.amount)}
                </div>
            </div>
        `).join('');
    },

    drawAccounts() {
        let h = `<div style="display:flex; justify-content:space-between; margin-bottom:15px"><h3>Wallet</h3><button onclick="UI.modalAccount()" style="border:none; background:none; color:var(--primary); font-weight:700">+ AGGIUNGI</button></div>`;
        Store.data.accounts.forEach(a => {
            h += `<div class="card" onclick="UI.modalAccount('${a.id}')" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; padding:20px;">
                <div><div style="font-weight:700; font-size:1.1rem">${a.name}</div><div style="font-size:0.8rem; opacity:0.6; text-transform:uppercase">${a.type}</div></div>
                <div style="font-size:1.2rem; font-weight:700; color:var(--primary)">${Utils.fmtMoney(a.balance)}</div>
            </div>`;
        });
        document.getElementById('main-content').innerHTML = h;
    },

    /* -- SPESE FISSE CORRETTE -- */
    drawRecurring() {
        // Calcolo totale sicuro (con parseFloat)
        const tot = Store.data.recurring.reduce((s, r) => r.active && r.type==='expense' ? s + parseFloat(r.amount) : s, 0);

        let h = `<div class="card" style="text-align:center; padding:25px; margin-bottom:50px;">
            <p style="opacity:0.6; font-size:0.9rem; margin-bottom:10px">Gestisci le spese automatiche</p>
            <button class="btn-primary" onclick="UI.modalRecurring()" style="width:auto; padding:10px 25px">＋ Aggiungi Nuova</button>
        </div>`;

        if(Store.data.recurring.length) {
            h = `<div style="padding-bottom:60px">`; 
            const sorted = [...Store.data.recurring].sort((a,b) => new Date(a.nextDate) - new Date(b.nextDate));
            const today = new Date();
            const curM = today.getMonth();
            const curY = today.getFullYear();

            sorted.forEach(r => {
                const nd = new Date(r.nextDate);
                // Logica Colori
                // Verde: Se anno > corrente, oppure anno == corrente ma mese > corrente.
                const isFuture = nd.getFullYear() > curY || (nd.getFullYear() === curY && nd.getMonth() > curM);
                
                let cssClass = 'rec-card ';
                let status = '';
                
                if (isFuture) {
                    cssClass += 'rec-green';
                    status = '✓ Addebitata / Futura';
                } else {
                    // È il mese corrente (o passato, se non processata)
                    cssClass += 'rec-yellow';
                    status = `⏳ In arrivo: ${Utils.fmtDate(r.nextDate)}`;
                }

                h += `<div class="${cssClass}" onclick="UI.modalRecurring('${r.id}')">
                    <div>
                        <div style="font-weight:700; font-size:1.05rem">${r.desc}</div>
                        <span class="status-badge">${status}</span>
                    </div>
                    <div style="font-weight:800; font-size:1.15rem">${Utils.fmtMoney(r.amount)}</div>
                </div>`;
            });
            h += `</div>`;
        }

        h += `<div class="total-float">Totale Fisse<span>${Utils.fmtMoney(tot)}</span></div>`;
        document.getElementById('main-content').innerHTML = h;
    },

    /* -- MODALS -- */
    openModal(t, h) { document.getElementById('modal-title').innerText=t; document.getElementById('modal-body').innerHTML=h; document.getElementById('modal-overlay').classList.remove('hidden'); },
    closeModal() { document.getElementById('modal-overlay').classList.add('hidden'); },

    modalTx(id=null) {
        const tx = id ? Store.data.transactions.find(t=>t.id===id) : {};
        const isE = !!id;
        const acs = Store.data.accounts.map(a=>`<option value="${a.id}" ${tx.accountId===a.id?'selected':''}>${a.name}</option>`).join('');
        const cats = Store.data.categories.map(c=>`<option ${tx.category===c?'selected':''}>${c}</option>`).join('');
        const h = `
            <div class="form-group"><label>Tipo</label><select id="i-type" onchange="UI.togTrsf()"><option value="expense" ${tx.type==='expense'?'selected':''}>Spesa</option><option value="income" ${tx.type==='income'?'selected':''}>Entrata</option><option value="transfer" ${tx.type==='transfer'?'selected':''}>Trasferimento</option></select></div>
            <div class="form-group"><label>Importo</label><input type="number" id="i-amt" step="0.01" value="${tx.amount||''}"></div>
            <div class="form-group" id="grp-desc"><label>Descrizione</label><input type="text" id="i-desc" value="${tx.desc||''}"></div>
            <div id="std-ui">
                <div class="form-group"><label>Categoria</label><select id="i-cat">${cats}</select></div>
                <div class="form-group"><label>Conto</label><select id="i-acc">${acs}</select></div>
                ${!isE ? '<div class="form-group"><label>Rate (Mesi)</label><input type="number" id="i-inst" value="1"></div>':''}
            </div>
            <div id="trf-ui" style="display:none"><div class="form-group"><label>Da</label><select id="i-from">${acs}</select></div><div class="form-group"><label>A</label><select id="i-to">${acs}</select></div></div>
            <div class="form-group"><label>Data</label><input type="date" id="i-date" value="${tx.date||Utils.today()}"></div>
            <button class="btn-primary" onclick="UI.saveTx('${id||''}')">Salva</button>
            ${isE?`<button class="btn-delete" onclick="Store.deleteTransaction('${id}');UI.closeModal();Router.refresh()">Elimina</button>`:''}
        `;
        this.openModal(isE?'Modifica':'Nuovo', h); this.togTrsf();
    },
    togTrsf() { const t = document.getElementById('i-type').value; document.getElementById('std-ui').style.display=t==='transfer'?'none':'block'; document.getElementById('grp-desc').style.display=t==='transfer'?'none':'block'; document.getElementById('trf-ui').style.display=t==='transfer'?'block':'none'; },
    saveTx(id) {
        const t=document.getElementById('i-type').value, amt=parseFloat(document.getElementById('i-amt').value);
        if(!amt) return alert('Inserisci importo');
        const tx = { id: id||Utils.genId(), type:t, amount:amt, date:document.getElementById('i-date').value, desc:t==='transfer'?'Giroconto':document.getElementById('i-desc').value, installments: document.getElementById('i-inst')?parseInt(document.getElementById('i-inst').value):1 };
        if(t==='transfer') { tx.fromAccount=document.getElementById('i-from').value; tx.toAccount=document.getElementById('i-to').value; tx.category='Bonifici'; }
        else { tx.category=document.getElementById('i-cat').value; tx.accountId=document.getElementById('i-acc').value; }
        Store.saveTransaction(tx); this.closeModal(); Router.refresh();
    },

    modalRecurring(id=null) {
        const r = id ? Store.data.recurring.find(x=>x.id===id) : {};
        const acs = Store.data.accounts.map(a=>`<option value="${a.id}" ${r.accountId===a.id?'selected':''}>${a.name}</option>`).join('');
        const cats = Store.data.categories.map(c=>`<option ${r.category===c?'selected':''}>${c}</option>`).join('');
        const h = `
            <div class="form-group"><label>Descrizione</label><input type="text" id="r-desc" value="${r.desc||''}"></div>
            <div class="form-group"><label>Importo</label><input type="number" id="r-amt" value="${r.amount||''}"></div>
            <div class="form-group"><label>Tipo</label><select id="r-type"><option value="expense">Uscita</option><option value="income" ${r.type==='income'?'selected':''}>Entrata</option></select></div>
            <div class="form-group"><label>Categoria</label><select id="r-cat">${cats}</select></div>
            <div class="form-group"><label>Conto</label><select id="r-acc">${acs}</select></div>
            <div class="form-group"><label>Prossima Data</label><input type="date" id="r-date" value="${r.nextDate||Utils.today()}"></div>
            <div class="form-group"><label>Frequenza (Mesi)</label><input type="number" id="r-freq" value="${r.freq||1}"></div>
            <div class="form-group"><label>Stato</label><select id="r-act"><option value="1">Attivo</option><option value="0" ${r.active===false?'selected':''}>Pausa</option></select></div>
            <button class="btn-primary" onclick="UI.saveRec('${id||''}')">Salva</button>
            ${id?`<button class="btn-delete" onclick="Store.deleteRecurring('${id}');UI.closeModal();Router.refresh()">Elimina</button>`:''}
        `;
        this.openModal(id?'Modifica Fissa':'Nuova Fissa', h);
    },
    saveRec(id) {
        const amt = parseFloat(document.getElementById('r-amt').value); if(!amt) return alert('Importo mancante');
        const rec = { 
            id:id||Utils.genId(), desc:document.getElementById('r-desc').value, amount:amt, type:document.getElementById('r-type').value, 
            category:document.getElementById('r-cat').value, accountId:document.getElementById('r-acc').value, 
            nextDate:document.getElementById('r-date').value, freq:parseInt(document.getElementById('r-freq').value), 
            active:document.getElementById('r-act').value==='1' 
        };
        Store.saveRecurring(rec); this.closeModal(); Router.refresh();
    },
    
    modalAccount(id=null) {
        const a = id?Store.data.accounts.find(x=>x.id===id):{};
        const h=`<div class="form-group"><label>Nome</label><input type="text" id="a-name" value="${a.name||''}"></div>
        <div class="form-group"><label>Tipo</label><select id="a-type"><option value="bank" ${a.type==='bank'?'selected':''}>Banca</option><option value="cash" ${a.type==='cash'?'selected':''}>Contanti</option><option value="savings" ${a.type==='savings'?'selected':''}>Risparmio</option></select></div>
        ${!id?`<div class="form-group"><label>Saldo Iniziale</label><input type="number" id="a-bal" value="0"></div>`:''}
        <button class="btn-primary" onclick="UI.saveAcc('${id||''}')">Salva</button>
        ${id?`<button class="btn-delete" onclick="if(confirm('Eliminare conto?')){Store.deleteAccount('${id}');UI.closeModal();Router.refresh()}">Elimina</button>`:''}`;
        this.openModal(id?'Modifica':'Nuovo', h);
    },
    saveAcc(id){ 
        const n=document.getElementById('a-name').value; if(!n) return;
        const acc = id?Store.data.accounts.find(a=>a.id===id):{id:Utils.genId(), balance:parseFloat(document.getElementById('a-bal').value)};
        acc.name=n; acc.type=document.getElementById('a-type').value; Store.saveAccount(acc); this.closeModal(); Router.refresh();
    },

    calcStats() {
        const d=new Date(), m=d.getMonth(), y=d.getFullYear();
        const txs = Store.data.transactions.filter(t=>{const x=new Date(t.date); return x.getMonth()===m && x.getFullYear()===y});
        const cats={}; txs.filter(t=>t.type==='expense').forEach(t=>cats[t.category]=(cats[t.category]||0)+t.amount);
        return { inc:txs.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0), exp:txs.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0), cats };
    },
    drawChart(d) {
        const c=document.getElementById('chart'); if(!c)return; if(window.myChart)window.myChart.destroy();
        window.myChart=new Chart(c,{type:'doughnut',data:{labels:Object.keys(d),datasets:[{data:Object.values(d),backgroundColor:['#0f766e','#f97316','#10b981','#06b6d4','#8b5cf6','#f43f5e','#64748b'],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'right',labels:{boxWidth:10,font:{size:11}}}},cutout:'70%'}});
    }
};

const Router = { page:'dashboard', navigate(p){this.page=p;document.querySelectorAll('.nav-item').forEach(e=>e.classList.remove('active'));document.querySelectorAll(`.nav-item[onclick*="${p}"]`).forEach(e=>e.classList.add('active'));UI.render()}, refresh(){this.navigate(this.page)}};
const Auth = { input:'', addPin(n){if(this.input.length<6){this.input+=n;this.render()}}, clearPin(){this.input='';this.render()}, render(){document.getElementById('pin-display').innerHTML=Array(this.input.length).fill('<div class="pin-dot filled"></div>').join('')}, checkPin(){if(!Store.data.pin){if(this.input.length>=4){Store.data.pin=this.input;Store.save();this.unlock()}else alert('Min 4 cifre')}else{if(this.input===Store.data.pin)this.unlock();else{document.getElementById('auth-msg').innerText='PIN Errato';this.clearPin()}}}, unlock(){document.getElementById('auth-screen').classList.remove('active');document.getElementById('app-screen').classList.add('active');Router.refresh()}};
window.onload=()=>{Store.init();Auth.input='';Auth.render();document.getElementById('fab-add').addEventListener('click',()=>UI.modalTx())};