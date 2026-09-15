'use client';
import {ErrorBox,Brand} from '@/components/batyeo/shared';
export default function ErrorPage({reset}:{reset:()=>void}){return <main className="section"><Brand/><h1 className="spaced">Une interruption passagère.</h1><ErrorBox message="Cette page n’a pas pu être chargée. Vos opérations enregistrées sont conservées." retry={reset}/></main>;}
