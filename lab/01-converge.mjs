import * as Y from 'yjs'

const doc1 = new Y.Doc()
const doc2 = new Y.Doc()

doc1.clientID = 2
doc2.clientID = 1

const text1 = doc1.getText('body')
const text2 = doc2.getText('body')

text1.insert(0, 'hello from doc1 ')
text2.insert(0, 'hello from doc2 ')

console.log('before:', text1.toString(), '|', text2.toString())

const update1 = Y.encodeStateAsUpdate(doc1)
const update2 = Y.encodeStateAsUpdate(doc2)

Y.applyUpdate(doc1, update2)
Y.applyUpdate(doc2, update1)

console.log('after:', text1.toString(), '|', text2.toString())