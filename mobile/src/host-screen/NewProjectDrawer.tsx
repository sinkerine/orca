import { useEffect, useRef, useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { BottomDrawer } from '../components/BottomDrawer'
import { newWorktreeFormStyles as styles } from '../components/new-worktree-form-styles'
import { colors } from '../theme/mobile-theme'
import type { RpcClient } from '../transport/rpc-client'
import {
  joinCreateProjectPath,
  newProjectCreate,
  newProjectDefaultParent,
  projectNameError
} from './new-project-operations'

type Props = {
  client: Pick<RpcClient, 'sendRequest'> | null
  connected: boolean
  hostName: string
  onClose: () => void
  onCreated: () => void
}

export function NewProjectDrawer(props: Props) {
  const [name, setName] = useState('')
  const [parent, setParent] = useState('')
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const parentTouched = useRef(false)
  const pending = useRef(false)
  const alive = useRef(true)
  const currentClient = useRef(props.client)
  currentClient.current = props.client
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  useEffect(() => {
    const client = props.client
    if (!client || !props.connected || parentTouched.current) {
      return
    }
    let cancelled = false
    void newProjectDefaultParent
      .request(client, { path: '~' })
      .then((reply) => {
        if (!cancelled && !parentTouched.current) {
          setParent(newProjectDefaultParent.interpret(reply))
        }
      })
      .catch(() => {
        // A host without directory browsing can still accept a typed absolute path.
      })
    return () => {
      cancelled = true
    }
  }, [props.client, props.connected])

  const canCreate =
    !!props.client && props.connected && !creating && !projectNameError(name) && !!parent.trim()
  async function submit() {
    const client = props.client
    if (!canCreate || !client || pending.current) {
      return
    }
    pending.current = true
    setCreating(true)
    setError('')
    try {
      const reply = await newProjectCreate.request(client, {
        name: name.trim(),
        parentPath: parent.trim(),
        kind: 'git'
      })
      const result = newProjectCreate.interpret(reply)
      if ('error' in result) {
        throw new Error(result.error)
      }
      props.onCreated()
      if (alive.current) {
        props.onClose()
      }
    } catch (failure) {
      if (alive.current && currentClient.current === client) {
        setError(failure instanceof Error ? failure.message : 'Could not create the project.')
      }
    } finally {
      pending.current = false
      if (alive.current) {
        setCreating(false)
      }
    }
  }
  return (
    <BottomDrawer visible onClose={props.onClose}>
      <View style={styles.header}>
        <Text style={styles.title}>New project</Text>
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>Create a Git repository on {props.hostName}.</Text>
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>Name</Text>
        <TextInput
          accessibilityLabel="Project name"
          style={styles.input}
          value={name}
          onChangeText={setName}
          editable={!creating}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="my-project"
          placeholderTextColor={colors.textMuted}
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>Parent folder on host</Text>
        <TextInput
          accessibilityLabel="Parent folder on host"
          style={styles.input}
          value={parent}
          onChangeText={(value) => {
            parentTouched.current = true
            setParent(value)
          }}
          editable={!creating}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Absolute host path"
          placeholderTextColor={colors.textMuted}
        />
      </View>
      {parent.trim() && name.trim() ? (
        <Text style={styles.label}>{joinCreateProjectPath(parent, name)}</Text>
      ) : null}
      {name.trim() && projectNameError(name) ? (
        <Text style={styles.error}>{projectNameError(name)}</Text>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {!props.connected ? (
        <Text style={styles.error}>Connect to the host to create a project.</Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Create project"
        disabled={!canCreate}
        style={[styles.createButton, !canCreate && styles.createButtonDisabled]}
        onPress={() => void submit()}
      >
        <Text style={styles.createText}>{creating ? 'Creating…' : 'Create project'}</Text>
      </Pressable>
    </BottomDrawer>
  )
}
