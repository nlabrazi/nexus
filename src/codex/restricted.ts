/** Extra process configuration for the Brain spike; normal coding sessions keep their defaults. */
export type RestrictedCodexProfile = 'inspection' | 'conversation';

export function restrictedCodexArgs(profile: RestrictedCodexProfile): string[] {
  const disabled = [
    'apps',
    'plugins',
    'remote_plugin',
    'hooks',
    'skill_mcp_dependency_install',
    'multi_agent',
    'multi_agent_v2',
    'browser_use',
    'computer_use',
    'image_generation',
    'code_mode',
    'code_mode_host',
    'code_mode_only',
    'memories',
  ];
  if (profile === 'conversation') {
    disabled.push('shell_tool', 'view_image');
  }
  return [
    '-c',
    'mcp_servers={}',
    '-c',
    'web_search="disabled"',
    '-c',
    'forced_login_method="chatgpt"',
    '-c',
    'model_provider="openai"',
    '-c',
    'shell_environment_policy.inherit="core"',
    ...(profile === 'conversation'
      ? ['-c', 'project_doc_max_bytes=0', '-c', 'skills.include_instructions=false']
      : []),
    ...disabled.flatMap((feature) => ['--disable', feature]),
  ];
}
