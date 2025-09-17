import * as Runno from '@runno/wasi'
import { SPSCReader } from 'spsc/reader'
import { SPSCWriter } from 'spsc/writer'
import { fread, bufGetUint32LE, writeLenPrefixed } from '$lib/stdlib'

const { stdin, stdout } = await new Promise<any>(r => {
  addEventListener('message', event => {
    r(event.data)
  }, { once: true })
})

const now = new Date()

/**
 * @param {string} path
 * @param {string} content
 */
function createFileEntry(path: string, content: string) {
  const obj = {
    path,
    timestamps: {
      access: now,
      change: now,
      modification: now,
    },
    mode: 'string' as const,
    content,
  }
  return { [path]: obj }
}

const fs = {
  ...createFileEntry('/source.agda', ''),
  ...createFileEntry('/lib/prim/Agda/Primitive.agda', `\
-- The Agda primitives (preloaded).

{-# OPTIONS --cubical-compatible --no-import-sorts --level-universe #-}

module Agda.Primitive where

------------------------------------------------------------------------
-- Universe levels
------------------------------------------------------------------------

infixl 6 _⊔_

{-# BUILTIN PROP           Prop      #-}
{-# BUILTIN TYPE           Set       #-}
{-# BUILTIN STRICTSET      SSet      #-}

{-# BUILTIN PROPOMEGA      Propω     #-}
{-# BUILTIN SETOMEGA       Setω      #-}
{-# BUILTIN STRICTSETOMEGA SSetω     #-}

{-# BUILTIN LEVELUNIV      LevelUniv #-}

-- Level is the first thing we need to define.
-- The other postulates can only be checked if built-in Level is known.

postulate
  Level : LevelUniv

-- MAlonzo compiles Level to (). This should be safe, because it is
-- not possible to pattern match on levels.

{-# BUILTIN LEVEL Level #-}

postulate
  lzero : Level
  lsuc  : (ℓ : Level) → Level
  _⊔_   : (ℓ₁ ℓ₂ : Level) → Level

{-# BUILTIN LEVELZERO lzero #-}
{-# BUILTIN LEVELSUC  lsuc  #-}
{-# BUILTIN LEVELMAX  _⊔_   #-}`),
  ...createFileEntry('/lib/prim/Agda/Primitive/Cubical.agda', `\
{-# OPTIONS --erased-cubical #-}

module Agda.Primitive.Cubical where

{-# BUILTIN CUBEINTERVALUNIV IUniv #-}  -- IUniv : SSet₁
{-# BUILTIN INTERVAL I  #-}  -- I : IUniv

{-# BUILTIN IZERO    i0 #-}
{-# BUILTIN IONE     i1 #-}

-- I is treated as the type of booleans.
{-# COMPILE JS i0 = false #-}
{-# COMPILE JS i1 = true  #-}

infix  30 primINeg
infixr 20 primIMin primIMax

primitive
    primIMin : I → I → I
    primIMax : I → I → I
    primINeg : I → I

{-# BUILTIN ISONE    IsOne    #-}  -- IsOne : I → Setω

postulate
  itIsOne : IsOne i1
  IsOne1  : ∀ i j → IsOne i → IsOne (primIMax i j)
  IsOne2  : ∀ i j → IsOne j → IsOne (primIMax i j)

{-# BUILTIN ITISONE  itIsOne  #-}
{-# BUILTIN ISONE1   IsOne1   #-}
{-# BUILTIN ISONE2   IsOne2   #-}

-- IsOne i is treated as the unit type.
{-# COMPILE JS itIsOne = { "tt" : a => a["tt"]() } #-}
{-# COMPILE JS IsOne1 =
  _ => _ => _ => { return { "tt" : a => a["tt"]() } }
  #-}
{-# COMPILE JS IsOne2 =
  _ => _ => _ => { return { "tt" : a => a["tt"]() } }
  #-}

-- Partial : ∀{ℓ} (i : I) (A : Set ℓ) → Set ℓ
-- Partial i A = IsOne i → A

{-# BUILTIN PARTIAL  Partial  #-}
{-# BUILTIN PARTIALP PartialP #-}

postulate
  isOneEmpty : ∀ {ℓ} {A : Partial i0 (Set ℓ)} → PartialP i0 A

{-# BUILTIN ISONEEMPTY isOneEmpty #-}

-- Partial i A and PartialP i A are treated as IsOne i → A.
{-# COMPILE JS isOneEmpty =
  _ => x => _ => x({ "tt" : a => a["tt"]() })
  #-}

primitive
  primPOr : ∀ {ℓ} (i j : I) {A : Partial (primIMax i j) (Set ℓ)}
            → (u : PartialP i (λ z → A (IsOne1 i j z)))
            → (v : PartialP j (λ z → A (IsOne2 i j z)))
            → PartialP (primIMax i j) A

  -- Computes in terms of primHComp and primTransp
  primComp : ∀ {ℓ} (A : (i : I) → Set (ℓ i)) {φ : I} (u : ∀ i → Partial φ (A i)) (a : A i0) → A i1

syntax primPOr p q u t = [ p ↦ u , q ↦ t ]

primitive
  primTransp : ∀ {ℓ} (A : (i : I) → Set (ℓ i)) (φ : I) (a : A i0) → A i1
  primHComp  : ∀ {ℓ} {A : Set ℓ} {φ : I} (u : ∀ i → Partial φ A) (a : A) → A


postulate
  PathP : ∀ {ℓ} (A : I → Set ℓ) → A i0 → A i1 → Set ℓ

{-# BUILTIN PATHP        PathP     #-}`),
}

const wasi = new Runno.WASI({ fs })
const drive = wasi.drive

onmessage = (event) => {
  if (event.data.method === 'write') {
    drive.fs['/source.agda'].mode = 'string'
    drive.fs['/source.agda'].content = event.data.content
    postMessage('done')
  } else if (event.data.method === 'dump') {
    console.warn('DUMP FS', drive.fs)
  } else {
    throw new Error('unrecognized event')
  }
}

const reader = new SPSCReader(stdin)
const writer = new SPSCWriter(stdout)

const encoder = new TextEncoder()
const decoder = new TextDecoder()

async function mainLoop() {
  const driveProxy = drive as unknown as {[k: string]: (...args: any[]) => any}
  while (true) {
    const ready = reader.pollRead(1000)
    if (!ready) {
      await new Promise(r => setTimeout(r))
      continue
    }
    const buf = fread(reader, 4)
    const data = fread(reader, bufGetUint32LE(buf))
    const req: { method: string; args: any[] } = JSON.parse(decoder.decode(data))

    // TODO: intercept open/read requests and map to entries from a zip image

    if (req.method === 'write') {
      // FIXME
      req.args[1] = new Uint8Array(req.args[1])
    }
    // console.warn('DRIVE <--', req)
    let res = driveProxy[req.method](...req.args)
    // console.warn('DRIVE -->', res)
    if (req.method === 'read') {
      // FIXME
      res[1] = Array.from(res[1])
    }
    writeLenPrefixed(writer, encoder.encode(JSON.stringify(res)))
  }
}

mainLoop()
