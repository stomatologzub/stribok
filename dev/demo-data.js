/* Demo dáta pre lokálny náhľad (vymyslené, nie skutočný projekt). */
(function(){
  const d=window.__docs; if(!d) return;
  const now=Date.now();
  d.set("meta/projects",{list:[{id:"demo",name:"Demo projekt",code:"0001/00",client:"Demo klient s.r.o.",archived:false}]});
  d.set("admin/_summary",{projects:{demo:{total:0,updatedAt:now}}});
  d.set("admin/demo",{version:1,project:{name:"Demo projekt",code:"0001/00",client:"Demo klient s.r.o."},rate:18,rounding:"group",
    prices:[{id:"p1",name:"Rozdeľovače",mj:"ks",price:8,hours:null,note:""},{id:"p2",name:"Výustky",mj:"ks",price:8,hours:null,note:""},
            {id:"p3",name:"Plastové hadice",mj:"bm",price:2,hours:null,note:""},{id:"p4",name:"Prestupy",mj:"ks",price:null,hours:0.75,note:"0,75 h na kus"},
            {id:"p5",name:"Transport",mj:"h",price:null,hours:1,note:""}],
    groups:[{id:"g1",sheet:"rek",blok:"A",section:"Blok A",name:"Byt A.01",count:1,hand:null,useHand:false,note:"",
              rows:[{id:"r1",item:"Rozdeľovače",qty:2,amount:null,note:""},{id:"r2",item:"Výustky",qty:6,amount:null,note:""},{id:"r3",item:"Plastové hadice",qty:60,amount:null,note:""},{id:"r4",item:"Prestupy",qty:8,amount:null,note:""},{id:"r5",item:"Transport",qty:1.5,amount:null,note:""}]},
            {id:"g2",sheet:"rek",blok:"A",section:"Blok A",name:"Byt A.02",count:2,hand:null,useHand:false,note:"v súpise „× 2“",
              rows:[{id:"r6",item:"Rozdeľovače",qty:2,amount:null,note:""},{id:"r7",item:"Výustky",qty:null,amount:null,note:""}]}],
    recapHand:{stuB:null,stuAll:null},recapUse:{},issues:[{id:"i1",where:"Byt A.02",written:"–",calc:"–",what:"Doplniť počet výustiek.",major:false,done:false}]});
  d.set("tasks/t1",{title:"Rekuperácia – Byt A.01",projectId:"demo",groupId:"g1",status:"doing",assignee:"u_me",techName:"",estH:7.5,estSrc:"supis",due:"",proofReq:true,photos:[],createdBy:"u_me",createdAt:now-2e5,updatedAt:now});
  d.set("tasks/t2",{title:"Rekuperácia – Byt A.02",projectId:"demo",groupId:"g2",status:"todo",assignee:null,techName:"Technik Demo",estH:null,due:"",proofReq:true,photos:[],createdBy:"u_me",createdAt:now-1e5,updatedAt:now});
  d.set("chat/m1",{ch:"team",by:"u_jano",text:"Dobré ráno, dnes som na Demo projekte.",photo:"",at:now-36e5});
})();
