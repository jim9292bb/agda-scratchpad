{-# OPTIONS --without-K --safe #-}

-- Deliberately a deep import (pulls in dozens of agda-categories + stdlib
-- modules transitively) so this test actually exercises the prebuilt
-- .agdai cache, not just a near-trivial one-module import.
open import Categories.Category.Monoidal.Instance.StrictCats
open import Categories.Category.Core using (Category)
open import Level using (suc; _⊔_)

module source where

idCategoryGoal : ∀ {o ℓ e} → Category o ℓ e → Category o ℓ e
idCategoryGoal C = {!   !}
