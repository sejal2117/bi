'''from __future__ import annotations
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from typing import List, Tuple

class TFIDFIndex:
    def __init__(self):
        self.vectorizer = TfidfVectorizer(ngram_range=(1,3), max_features=20000)
        self.matrix = None
        self.texts: List[str] = []

    def fit(self, texts: List[str]):
        self.texts = texts
        if not texts:
            self.matrix = None
            return
        self.matrix = self.vectorizer.fit_transform(texts)

    def search(self, query: str, top_k: int = 10) -> List[Tuple[int, float]]:
        if not self.matrix:
            return []
        qv = self.vectorizer.transform([query])
        sims = cosine_similarity(qv, self.matrix)[0]
        ranked = sorted(enumerate(sims), key=lambda x: x[1], reverse=True)
        return ranked[:top_k]
 '''   
from __future__ import annotations
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from typing import List, Tuple

class TFIDFIndex:
    def __init__(self):
        self.vectorizer = TfidfVectorizer(ngram_range=(1, 3), max_features=20000)
        self.matrix = None
        self.texts: List[str] = []

    def fit(self, texts: List[str]):
        self.texts = texts
        if not texts:
            self.matrix = None
            return
        self.matrix = self.vectorizer.fit_transform(texts)

    def search(self, query: str, top_k: int = 10) -> List[Tuple[int, float]]:
        if self.matrix is None:
            return []
        qv = self.vectorizer.transform([query])
        sims = cosine_similarity(qv, self.matrix)[0]
        ranked = sorted(enumerate(sims), key=lambda x: x[1], reverse=True)
        return ranked[:top_k]
