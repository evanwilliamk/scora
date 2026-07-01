import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';

dotenv.config();
const f = Fastify({ logger: true });
f.register(cors);

f.get('/', (r,p)=>p.type('text/html').send('<h1>SCORA</h1><p>S</p><a href="/privacy">Privacy</a> <a href="/terms">Terms</a>'));
f.get('/privacy', (r,p)=>p.type('text/html').send('<h1>Privacy</h1><p>Last updated: July 1, 2026</p><p>We collect fitness data from Strava, Oura, Apple Health.</p>'));
f.get('/terms', (r,p)=>p.type('text/html').send('<h1>Terms</h1><p>Last updated: July 1, 2026</p><p>Use SCORA for personal purposes only.</p>'));
f.get('/health', (r,p)=>({ok:true}));

const SID='228067', SS=process.env.STRAVA_SECRET||'', SR='https://zonal-prosperity-production-3965.up.railway.app/api/auth/strava/callback';
f.get('/api/auth/strava', (r,p)=>p.redirect(302, `https://www.strava.com/oauth/authorize?client_id=${SID}&response_type=code&redirect_uri=${encodeURIComponent(SR)}&scope=read,activity:read_all`));
f.get('/api/auth/strava/callback', async(r,p)=>{const{code}=r.query;if(!code)return p.code(400).send({e:'no code'});try{const res=await fetch('https://www.strava.com/oauth/token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_id:SID,client_secret:SS,code,grant_type:'authorization_code'})});if(!res.ok)return p.code(400).send({e:'failed'});const d=await res.json(),name=d.athlete.firstname,id=d.athlete.id,link=`scora://auth/success?athlete_id=${id}&name=${encodeURIComponent(name)}`;return(r.headers['user-agent']||'').includes('iPhone')?p.redirect(302,link):p.type('text/html').send(`<h1>✅</h1><h2>Strava</h2><p>${name}</p><a href="${link}">Open</a>`);}catch(e){return p.code(500).send({e:'error'});}});

const OID=process.env.OURA_ID||'', OS=process.env.OURA_SECRET||'', OR='https://zonal-prosperity-production-3965.up.railway.app/api/auth/oura/callback';
f.get('/api/auth/oura', (r,p)=>p.redirect(302, `https://cloud.ouraring.com/oauth/authorize?client_id=${OID}&response_type=code&redirect_uri=${encodeURIComponent(OR)}&scope=personal`));
f.get('/api/auth/oura/callback', async(r,p)=>{const{code}=r.query;if(!code)return p.code(400).send({e:'no code'});try{const res=await fetch('https://api.ouraring.com/oauth/token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_id:OID,client_secret:OS,code,grant_type:'authorization_code'})});if(!res.ok)return p.code(400).send({e:'failed'});const link='scora://auth/oura/success';return(r.headers['user-agent']||'').includes('iPhone')?p.redirect(302,link):p.type('text/html').send('<h1>✅</h1><h2>Oura</h2><p>Connected</p><a href="'+link+'">Open</a>');}catch(e){return p.code(500).send({e:'error'});}});

f.listen({port:3000,host:'0.0.0.0'}, (e,a)=>{if(e){f.log.error(e);process.exit(1);}console.log(a);});
