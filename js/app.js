/* === UTILS === */
const Utils = {
    fmtMoney: (v) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(v),
    fmtDate: (d) => d ? new Date(d).toLocaleDateString('it-IT', {day:'2-digit', month:'2-digit', year:'numeric'}) : 'N/D',
    genId: () => Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
    
    // DATA LOCALE CORRETTA (YYYY-MM-DD)
    today: () => { 
        const d = new Date(); 
        const offset = d.getTimezoneOffset() * 60000; 
        return new Date(d.getTime() - offset).toISOString().split('T')[0]; 
    },
    
    addMonths: (d, m) => { 
        let x = new Date(d); 
        if(isNaN(x.getTime())) return Utils.today(); 
        x.setMonth(x.getMonth() + parseInt(m)); 
        return x.toISOString().split('T')[0]; 
    }
};

/* === STORE === */
const Store = {
    data: { 
        pin: null, accounts: [], transactions: [], recurring: [], 
        categories: ['Alimentari', 'Casa', 'Trasporti', 'Svago', 'Salute', 'Shopping', 'Ristoranti', 'Stipendio', 'Altro'], 
        settings: { theme: 'light' } 
    },

    init() {
        const s = localStorage.getItem('LUMO_V3');
        if (s) { 
            try { 
                this.data = JSON.parse(s); 
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
    saveAccount(acc) { const idx = this.data.accounts.findIndex(a => a.id === acc.id); if (idx > -1) this.data.accounts[idx] = acc; else this.data.accounts.push(acc); this.save(); },
    deleteAccount(id) { this.data.accounts = this.data.accounts.filter(a => a.id !== id); this.data.transactions = this.data.transactions.filter(t => t.accountId !== id && t.fromAccount !== id && t.toAccount !== id); this.data.recurring = this.data.recurring.filter(r => r.accountId !== id); this.save(); },
    
    saveTransaction(tx) {
        const oldIdx = this.data.transactions.findIndex(t => t.id === tx.id);
        if (oldIdx > -1) { this.revertBalance(this.data.transactions[oldIdx]); this.data.transactions[oldIdx] = tx; } 
        else {
            if (tx.installments > 1 && tx.type === 'expense') {
                const baseAmt = tx.amount / tx.installments; const baseDate = new Date(tx.date);
                for (let i = 0; i < tx.installments; i++) {
                    const nextD = new Date(baseDate); nextD.setMonth(baseDate.getMonth() + i);
                    const newTx = { ...tx, id: (i===0?tx.id:Utils.genId()), amount: baseAmt, date: nextD.toISOString().split('T')[0], desc: `${tx.desc} (${i+1}/${tx.installments})`, installments: 1 };
                    this.data.transactions.push(newTx); this.applyBalance(newTx);
                } this.save(); return;
            } this.data.transactions.push(tx);
        } this.applyBalance(tx); this.save();
    },
    
    deleteTransaction(id) { const idx = this.data.transactions.findIndex(t => t.id === id); if (idx > -1) { this.revertBalance(this.data.transactions[idx]); this.data.transactions.splice(idx, 1); this.save(); } },
    
    saveRecurring(rec) { const idx = this.data.recurring.findIndex(r => r.id === rec.id); if (idx > -1) this.data.recurring[idx] = rec; else this.data.recurring.push(rec); this.save(); this.checkRecurring(); },
    
    deleteRecurring(id) { this.data.recurring = this.data.recurring.filter(r => r.id !== id); this.save(); },
    
    addCategory(n) { if(!this.data.categories.includes(n)) { this.data.categories.push(n); this.save(); } },
    updateCategory(o, n) { const i = this.data.categories.indexOf(o); if(i>-1) { this.data.categories[i]=n; this.data.transactions.forEach(t=>{if(t.category===o)t.category=n}); this.data.recurring.forEach(r=>{if(r.category===o)r.category=n}); this.save(); } },
    deleteCategory(n) { this.data.categories = this.data.categories.filter(c=>c!==n); this.data.transactions.forEach(t=>{if(t.category===n)t.category='Altro'}); this.save(); },
    
    updateAccBal(id, amt, type, rev=false) { const acc = this.data.accounts.find(a => a.id === id); if(!acc) return; let v = parseFloat(amt); if(rev) v = -v; if(type === 'income') acc.balance += v; else acc.balance -= v; },
    applyBalance(tx) { if(tx.type==='transfer') { this.updateAccBal(tx.fromAccount,tx.amount,'expense'); this.updateAccBal(tx.toAccount,tx.amount,'income'); } else this.updateAccBal(tx.accountId,tx.amount,tx.type); },
    revertBalance(tx) { if(tx.type==='transfer') { this.updateAccBal(tx.fromAccount,tx.amount,'expense',true); this.updateAccBal(tx.toAccount,tx.amount,'income',true); } else this.updateAccBal(tx.accountId,tx.amount,tx.type,true); },

    /* -- LOGICA SCADENZE RIGOROSA -- */
    checkRecurring() {
        const todayStr = Utils.today(); 
        let changed = false;
        
        this.data.recurring.forEach(r => {
            if (!r.active || !r.nextDate) return;
            
            // SE LA DATA È FUTURA (es. 20 Feb e oggi è 3 Feb): STOP.
            // Non tocca nulla. Rimane "in attesa".
            if (r.nextDate > todayStr) return; 

            // SE LA DATA È OGGI O PASSATA: PROCEDI.
            let safety = 0;
            while (r.nextDate <= todayStr && safety < 12) {
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
                
                // 1. Crea la transazione
                this.data.transactions.push(tx); 
                // 2. Aggiorna i saldi
                this.applyBalance(tx);
                // 3. Sposta la data al prossimo mese
                r.nextDate = Utils.addMonths(r.nextDate, parseInt(r.freq) || 1);
                
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

    drawDash() {
        // Mostra solo liquidità
        const liquidAccounts = Store.data.accounts.filter(a => a.type !== 'savings');
        const total = liquidAccounts.reduce((s,a) => s + a.balance, 0);
        const stats = this.calcStats();
        
        let accHtml = '';
        liquidAccounts.forEach(a => {
            accHtml += `<div style="display:flex; justify-content:space-between; padding:10px 0; border-bottom:1px solid var(--border)">
                <div style="font-size:0.9rem; font-weight:600">${a.name}</div>
                <div style="font-weight:700; color:${a.balance>=0?'var(--text-main)':'var(--danger)'}">${Utils.fmtMoney(a.balance)}</div>
            </div>`;
        });
        
        document.getElementById('main-content').innerHTML = `
            <div class="balance-card">
                <p style="opacity:0.8; font-size:0.9rem; text-transform:uppercase;">Liquidità Disponibile</p>
                <h2>${Utils.fmtMoney(total)}</h2>
            </div>
            <div class="card" style="padding-top:10px; padding-bottom:10px">${accHtml||'<p style="text-align:center; opacity:0.5">Nessun conto operativo</p>'}</div>
            <div class="summary-grid">
                <div class="card"><p>Entrate</p><span class="amount pos" style="font-size:1.3rem">+${Utils.fmtMoney(stats.inc)}</span></div>
                <div class="card"><p>Uscite</p><span class="amount neg" style="font-size:1.3rem; color:var(--danger)">-${Utils.fmtMoney(stats.exp)}</span></div>
            </div>
            <div class="card"><h3 style="margin-bottom:15px">Spese Mensili</h3><div style="height:250px"><canvas id="chart"></canvas></div></div>
            <div class="card"><h3>Recenti</h3><div id="mini-list"></div></div>
        `;
        this.drawList(Store.data.transactions.slice().sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,5), 'mini-list');
        this.drawChart(stats.cats);
    },

    drawTxList() {
        const all = [...Store.data.transactions].sort((a,b) => new Date(b.date) - new Date(a.date));
        document.getElementById('main-content').innerHTML = `<div class="card" style="position:sticky; top:0; z-index:10; padding:15px;"><input type="text" id="search" placeholder="🔍 Cerca..." onkeyup="UI.render()" style="padding:12px; width:100%; border-radius:12px; border:1px solid var(--border)"></div><div class="card" style="padding-top:0"><div id="full-list"></div></div>`;
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
                    <div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-right:10px"><div style="font-weight:700">${t.desc}</div><div style="font-size:0.8rem; opacity:0.7">${Utils.fmtDate(t.date)} • ${t.category}</div></div>
                </div>
                <div class="amount ${t.type==='expense'?'neg':(t.type==='income'?'pos':'')}">${t.type==='expense'?'-':(t.type==='income'?'+':'')}${Utils.fmtMoney(t.amount)}</div>
            </div>`).join('');
    },

    drawAccounts() {
        const savings = Store.data.accounts.filter(a => a.type === 'savings');
        const liquid = Store.data.accounts.filter(a => a.type !== 'savings');
        const totSavings = savings.reduce((s,a) => s + a.balance, 0);

        let h = '';
        h += `<div class="savings-card"><p style="opacity:0.9; font-size:0.9rem; text-transform:uppercase;">Totale Risparmi</p><h2>${Utils.fmtMoney(totSavings)}</h2></div>`;
        h += `<h4 style="margin:20px 0 10px 5px; opacity:0.7">Conti Deposito & Salvadanai</h4>`;
        savings.forEach(a => { h += `<div class="acc-card acc-savings" onclick="UI.modalAccount('${a.id}')"><div><div style="font-weight:700; font-size:1.1rem">${a.name}</div><div style="font-size:0.8rem; opacity:0.6; text-transform:uppercase">Risparmio</div></div><div style="font-size:1.2rem; font-weight:700; color:var(--gold)">${Utils.fmtMoney(a.balance)}</div></div>`; });
        if(savings.length === 0) h += `<div style="text-align:center; padding:15px; opacity:0.5; font-style:italic">Nessun conto risparmio attivo</div>`;
        h += `<h4 style="margin:30px 0 10px 5px; opacity:0.7">Conti Operativi (Liquidità)</h4>`;
        liquid.forEach(a => { h += `<div class="acc-card" onclick="UI.modalAccount('${a.id}')"><div><div style="font-weight:700; font-size:1.1rem">${a.name}</div><div style="font-size:0.8rem; opacity:0.6; text-transform:uppercase">${a.type}</div></div><div style="font-size:1.2rem; font-weight:700; color:var(--primary)">${Utils.fmtMoney(a.balance)}</div></div>`; });
        h += `<div style="height:80px; display:flex; align-items:center; justify-content:center;"><button onclick="UI.modalAccount()" style="background:none; border:2px dashed var(--border); padding:15px 40px; border-radius:15px; color:var(--text-muted); font-weight:700">+ Aggiungi Conto</button></div>`;
        document.getElementById('main-content').innerHTML = h;
    },

    /* -- LOGICA COLORI CORRETTA -- */
    drawRecurring() {
        const tot = Store.data.recurring.reduce((s, r) => r.active && r.type==='expense' ? s + parseFloat(r.amount) : s, 0);
        let h = `<div class="card" style="text-align:center; padding:25px; margin-bottom:50px;"><p style="opacity:0.6; font-size:0.9rem; margin-bottom:10px">Gestisci le spese automatiche</p><button class="btn-primary" onclick="UI.modalRecurring()" style="width:auto; padding:10px 25px">＋ Aggiungi Nuova</button></div>`;
        
        if(Store.data.recurring.length > 0) {
            h += `<div style="padding-bottom:80px">`; 
            const sorted = [...Store.data.recurring].sort((a,b) => new Date(a.nextDate) - new Date(b.nextDate));
            const today = new Date();
            // Ottengo solo Anno e Mese correnti per il confronto
            const curMonth = today.getMonth(); 
            const curYear = today.getFullYear();

            sorted.forEach(r => {
                const nd = new Date(r.nextDate);
                const ndMonth = nd.getMonth();
                const ndYear = nd.getFullYear();
                
                // LOGICA:
                // Se la data visualizzata è STESSO MESE E ANNO di oggi -> È Gialla (deve ancora scadere)
                // Se la data visualizzata è MESE PROSSIMO (o anno prossimo) -> È Verde (è già stata pagata questo mese)
                
                let isCurrentMonth = (ndMonth === curMonth && ndYear === curYear);
                
                let cssClass = '';
                let status = '';

                if (isCurrentMonth) {
                    cssClass = 'rec-card rec-yellow';
                    status = `⏳ In arrivo: ${Utils.fmtDate(r.nextDate)}`;
                } else {
                    cssClass = 'rec-card rec-green';
                    status = `✓ Addebitata (Prox: ${Utils.fmtDate(r.nextDate)})`;
                }

                h += `<div class="${cssClass}" onclick="UI.modalRecurring('${r.id}')"><div><div style="font-weight:700; font-size:1.05rem">${r.desc}</div><span class="status-badge">${status}</span></div><div style="font-weight:800; font-size:1.15rem">${Utils.fmtMoney(r.amount)}</div></div>`;
            }); h += `</div>`;
        }
        h += `<div class="total-float">Totale Fisse<span>${Utils.fmtMoney(tot)}</span></div>`;
        document.getElementById('main-content').innerHTML = h;
    },

    /* -- MODALS -- */
    openModal(t, h) { document.getElementById('modal-title').innerText=t; document.getElementById('modal-body').innerHTML=h; document.getElementById('modal-overlay').classList.remove('hidden'); },
    closeModal() { document.getElementById('modal-overlay').classList.add('hidden'); },
    modalTx(id=null) {
        const tx = id ? Store.data.transactions.find(t=>t.id===id) : {}; const isE = !!id;
        const acs = Store.data.accounts.map(a=>`<option value="${a.id}" ${tx.accountId===a.id?'selected':''}>${a.name}</option>`).join('');
        const cats = Store.data.categories.map(c=>`<option ${tx.category===c?'selected':''}>${c}</option>`).join('');
        const h = `<div class="form-group"><label>Tipo</label><select id="i-type" onchange="UI.togTrsf()"><option value="expense" ${tx.type==='expense'?'selected':''}>Spesa</option><option value="income" ${tx.type==='income'?'selected':''}>Entrata</option><option value="transfer" ${tx.type==='transfer'?'selected':''}>Trasferimento</option></select></div><div class="form-group"><label>Importo</label><input type="number" id="i-amt" step="0.01" value="${tx.amount||''}"></div><div class="form-group" id="grp-desc"><label>Descrizione</label><input type="text" id="i-desc" value="${tx.desc||''}"></div><div id="std-ui"><div class="form-group"><label>Categoria</label><select id="i-cat">${cats}</select></div><div class="form-group"><label>Conto</label><select id="i-acc">${acs}</select></div>${!isE ? '<div class="form-group"><label>Rate (Mesi)</label><input type="number" id="i-inst" value="1"></div>':''}</div><div id="trf-ui" style="display:none"><div class="form-group"><label>Da</label><select id="i-from">${acs}</select></div><div class="form-group"><label>A</label><select id="i-to">${acs}</select></div></div><div class="form-group"><label>Data</label><input type="date" id="i-date" value="${tx.date||Utils.today()}"></div><button class="btn-primary" onclick="UI.saveTx('${id||''}')">Salva</button>${isE?`<button class="btn-delete" onclick="Store.deleteTransaction('${id}');UI.closeModal();Router.refresh()">Elimina</button>`:''}`;
        this.openModal(isE?'Modifica':'Nuovo', h); this.togTrsf();
    },
    togTrsf() { const t = document.getElementById('i-type').value; document.getElementById('std-ui').style.display=t==='transfer'?'none':'block'; document.getElementById('grp-desc').style.display=t==='transfer'?'none':'block'; document.getElementById('trf-ui').style.display=t==='transfer'?'block':'none'; },
    saveTx(id) {
        const t=document.getElementById('i-type').value, amt=parseFloat(document.getElementById('i-amt').value); if(!amt) return alert('Inserisci importo');
        const tx = { id: id||Utils.genId(), type:t, amount:amt, date:document.getElementById('i-date').value, desc:t==='transfer'?'Giroconto':document.getElementById('i-desc').value, installments: document.getElementById('i-inst')?parseInt(document.getElementById('i-inst').value):1 };
        if(t==='transfer') { tx.fromAccount=document.getElementById('i-from').value; tx.toAccount=document.getElementById('i-to').value; tx.category='Bonifici'; } else { tx.category=document.getElementById('i-cat').value; tx.accountId=document.getElementById('i-acc').value; }
        Store.saveTransaction(tx); this.closeModal(); Router.refresh();
    },
    modalRecurring(id=null) {
        const r = id ? Store.data.recurring.find(x=>x.id===id) : {}; const acs = Store.data.accounts.map(a=>`<option value="${a.id}" ${r.accountId===a.id?'selected':''}>${a.name}</option>`).join(''); const cats = Store.data.categories.map(c=>`<option ${r.category===c?'selected':''}>${c}</option>`).join('');
        const h = `<div class="form-group"><label>Descrizione</label><input type="text" id="r-desc" value="${r.desc||''}"></div><div class="form-group"><label>Importo</label><input type="number" id="r-amt" value="${r.amount||''}"></div><div class="form-group"><label>Tipo</label><select id="r-type"><option value="expense">Uscita</option><option value="income" ${r.type==='income'?'selected':''}>Entrata</option></select></div><div class="form-group"><label>Categoria</label><select id="r-cat">${cats}</select></div><div class="form-group"><label>Conto</label><select id="r-acc">${acs}</select></div><div class="form-group"><label>Prossima Data</label><input type="date" id="r-date" value="${r.nextDate||Utils.today()}"></div><div class="form-group"><label>Frequenza (Mesi)</label><input type="number" id="r-freq" value="${r.freq||1}"></div><div class="form-group"><label>Stato</label><select id="r-act"><option value="1">Attivo</option><option value="0" ${r.active===false?'selected':''}>Pausa</option></select></div><button class="btn-primary" onclick="UI.saveRec('${id||''}')">Salva</button>${id?`<button class="btn-delete" onclick="Store.deleteRecurring('${id}');UI.closeModal();Router.refresh()">Elimina</button>`:''}`;
        this.openModal(id?'Modifica Fissa':'Nuova Fissa', h);
    },
    saveRec(id) {
        const amt = parseFloat(document.getElementById('r-amt').value); if(!amt) return alert('Importo mancante');
        const rec = { id:id||Utils.genId(), desc:document.getElementById('r-desc').value, amount:amt, type:document.getElementById('r-type').value, category:document.getElementById('r-cat').value, accountId:document.getElementById('r-acc').value, nextDate:document.getElementById('r-date').value, freq:parseInt(document.getElementById('r-freq').value), active:document.getElementById('r-act').value==='1' };
        Store.saveRecurring(rec); this.closeModal(); Router.refresh();
    },
    modalAccount(id=null) {
        const a = id?Store.data.accounts.find(x=>x.id===id):{};
        const h=`<div class="form-group"><label>Nome</label><input type="text" id="a-name" value="${a.name||''}"></div><div class="form-group"><label>Tipo</label><select id="a-type"><option value="bank" ${a.type==='bank'?'selected':''}>Banca</option><option value="cash" ${a.type==='cash'?'selected':''}>Contanti</option><option value="savings" ${a.type==='savings'?'selected':''}>Risparmio</option></select></div>${!id?`<div class="form-group"><label>Saldo Iniziale</label><input type="number" id="a-bal" value="0"></div>`:''}<button class="btn-primary" onclick="UI.saveAcc('${id||''}')">Salva</button>${id?`<button class="btn-delete" onclick="if(confirm('Eliminare conto?')){Store.deleteAccount('${id}');UI.closeModal();Router.refresh()}">Elimina</button>`:''}`;
        this.openModal(id?'Modifica':'Nuovo', h);
    },
    saveAcc(id){ const n=document.getElementById('a-name').value; if(!n) return; const acc = id?Store.data.accounts.find(a=>a.id===id):{id:Utils.genId(), balance:parseFloat(document.getElementById('a-bal').value)}; acc.name=n; acc.type=document.getElementById('a-type').value; Store.saveAccount(acc); this.closeModal(); Router.refresh(); },
    
    // CHART CON PERCENTUALI
    calcStats() {
        const d=new Date(), m=d.getMonth(), y=d.getFullYear();
        const txs = Store.data.transactions.filter(t=>{const x=new Date(t.date); return x.getMonth()===m && x.getFullYear()===y});
        const cats={}; txs.filter(t=>t.type==='expense').forEach(t=>cats[t.category]=(cats[t.category]||0)+t.amount);
        return { inc:txs.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0), exp:txs.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0), cats };
    },
    drawChart(d) {
        const c=document.getElementById('chart'); if(!c)return; if(window.myChart)window.myChart.destroy();
        Chart.register(ChartDataLabels);
        window.myChart=new Chart(c,{type:'doughnut',data:{labels:Object.keys(d),datasets:[{data:Object.values(d),backgroundColor:['#0f766e','#f97316','#10b981','#06b6d4','#8b5cf6','#f43f5e','#64748b'],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'right',labels:{boxWidth:10,font:{size:11}}},tooltip:{enabled:true},datalabels:{color:'#fff',font:{weight:'bold',size:11},formatter:(val,ctx)=>{let sum=0;let dataArr=ctx.chart.data.datasets[0].data;dataArr.map(data=>{sum+=data});let percentage=(val*100/sum).toFixed(0)+"%";return percentage;}}},cutout:'65%'}});
    },
    modalSettings() { const theme = Store.data.settings.theme; const h=`<div class="card" style="margin-top:0"><button class="list-item" style="width:100%; border:none; background:none;" onclick="UI.modalCategories()"><div style="font-weight:600">🏷 Gestione Categorie</div><div>›</div></button><div class="list-item" style="cursor:default"><div style="font-weight:600">Tema Scuro</div><button onclick="UI.toggleTheme()" style="padding:8px 15px; border-radius:20px; border:1px solid var(--border); background:var(--bg-body)">${theme==='dark'?'ON':'OFF'}</button></div></div><div class="card"><h4>Dati & Sicurezza</h4><button class="btn-primary" style="background:#475569; margin-bottom:10px" onclick="DataMgr.exportData()">📤 Backup Dati</button><button class="btn-primary" style="background:#475569" onclick="DataMgr.importData()">📥 Ripristina Backup</button><input type="file" id="import-file" style="display:none" onchange="DataMgr.handleFile(this)"><p style="font-size:0.8rem; color:var(--text-muted); margin-top:15px; text-align:center;">LUMO v4.2</p></div>`; this.openModal('Impostazioni', h); },
    toggleTheme() { Store.data.settings.theme = Store.data.settings.theme==='light'?'dark':'light'; Store.applyTheme(); Store.save(); this.modalSettings(); },
    modalCategories() { let h=`<div class="form-group" style="display:flex; gap:10px;"><input type="text" id="new-cat" placeholder="Nuova..."><button class="btn-primary" style="width:auto; margin:0;" onclick="UI.addCat()">+</button></div><div class="cat-list">`; Store.data.categories.forEach(c=>{h+=`<div class="cat-item"><span contenteditable="true" onblur="UI.editCat('${c}',this.innerText)">${c}</span><div class="cat-actions"><button style="color:var(--text-muted)">✏️</button><button style="color:var(--danger)" onclick="if(confirm('Eliminare?'))UI.delCat('${c}')">🗑</button></div></div>`}); h+='</div>'; this.openModal('Categorie', h); },
    addCat() { const v=document.getElementById('new-cat').value.trim(); if(v){Store.addCategory(v);this.modalCategories()} },
    editCat(o,n) { if(n&&n!==o)Store.updateCategory(o,n) },
    delCat(n) { Store.deleteCategory(n);this.modalCategories() }
};

const Router={page:'dashboard',navigate(p){this.page=p;document.querySelectorAll('.nav-item').forEach(e=>e.classList.remove('active'));document.querySelectorAll(`.nav-item[onclick*="${p}"]`).forEach(e=>e.classList.add('active'));UI.render()},refresh(){this.navigate(this.page)}};
const Auth={input:'',addPin(n){if(this.input.length<6){this.input+=n;this.render()}},clearPin(){this.input='';this.render()},render(){document.getElementById('pin-display').innerHTML=Array(this.input.length).fill('<div class="pin-dot filled"></div>').join('')},checkPin(){if(!Store.data.pin){if(this.input.length>=4){Store.data.pin=this.input;Store.save();this.unlock()}else alert('Min 4 cifre')}else{if(this.input===Store.data.pin)this.unlock();else{document.getElementById('auth-msg').innerText='PIN Errato';this.clearPin()}}},unlock(){document.getElementById('auth-screen').classList.remove('active');document.getElementById('app-screen').classList.add('active');Router.refresh()}};
window.onload=()=>{Store.init();Auth.input='';Auth.render();document.getElementById('fab-add').addEventListener('click',()=>UI.modalTx())};